"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AvatarEvent } from "@/lib/app/avatar-state";
import { cleanSpeechText, splitSpeechChunks } from "@/lib/app/speech-text";

const LEVEL_HZ = 30;
/** A context the browser will not start (no gesture) must not wedge the queue. */
const RESUME_TIMEOUT_MS = 2000;
/** Speech RMS sits around 0.05 to 0.25; this brings it to the avatar's 0..1 range. */
const LEVEL_GAIN = 4;

interface Item {
  audio: Promise<ArrayBuffer | null>;
}

interface Player {
  ctx: AudioContext;
  analyser: AnalyserNode;
}

/**
 * Plays EGO's replies aloud, one after another in the order they were queued, and feeds the
 * output level to the avatar. Each reply is fetched as soon as it is queued so the next one
 * is ready when the current one ends. A reply is split into sentence chunks so the first
 * sound does not wait for the whole reply to be synthesized. `levelRef` is read by Avatar,
 * updated at about 30 Hz. Browsers only start audio after a user gesture, so call
 * `unlock()` from the tap or key press that starts a turn.
 */
export function useSpeech(dispatch: (e: AvatarEvent) => void) {
  const levelRef = useRef<number | null>(null);
  const playerRef = useRef<Player | null>(null);
  const queueRef = useRef<Item[]>([]);
  const playingRef = useRef(false);
  const startedRef = useRef(false);
  const generationRef = useRef(0);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const stopLevel = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = undefined;
    levelRef.current = null;
  }, []);

  const startLevel = useCallback((analyser: AnalyserNode) => {
    clearInterval(timerRef.current);
    const buf = new Float32Array(analyser.fftSize);
    timerRef.current = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const level = Math.min(1, Math.sqrt(sum / buf.length) * LEVEL_GAIN);
      levelRef.current = level;
    }, 1000 / LEVEL_HZ);
  }, []);

  const ensurePlayer = useCallback((): Player | null => {
    if (playerRef.current) return playerRef.current;
    const Ctor =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.connect(ctx.destination);
    playerRef.current = { ctx, analyser };
    return playerRef.current;
  }, []);

  const finish = useCallback(() => {
    playingRef.current = false;
    stopLevel();
    if (startedRef.current) dispatchRef.current({ type: "speech_end" });
    else dispatchRef.current({ type: "speech_abandoned" });
    startedRef.current = false;
  }, [stopLevel]);

  const pump = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    const generation = generationRef.current;
    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      const bytes = await item.audio;
      if (generation !== generationRef.current) return;
      const player = ensurePlayer();
      if (!bytes || !player) continue;
      try {
        await Promise.race([
          player.ctx.resume(),
          new Promise<void>((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
        ]);
        if (generation !== generationRef.current) return;
        // Still suspended: skip this reply rather than wait for a gesture that is not coming.
        if (player.ctx.state !== "running") continue;
        const buffer = await player.ctx.decodeAudioData(bytes);
        if (generation !== generationRef.current) return;
        const source = player.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(player.analyser);
        sourceRef.current = source;
        const ended = new Promise<void>((resolve) => {
          source.onended = () => resolve();
        });
        if (!startedRef.current) {
          startedRef.current = true;
          dispatchRef.current({ type: "speech_start" });
          startLevel(player.analyser);
        }
        source.start();
        await ended;
        if (generation !== generationRef.current) return;
      } catch {
        // An undecodable reply is skipped; the next one still plays.
      }
    }
    if (generation === generationRef.current) finish();
  }, [ensurePlayer, finish, startLevel]);

  /** Creates and resumes the audio context; call from a user gesture. */
  const unlock = useCallback(() => {
    void ensurePlayer()?.ctx.resume().catch(() => undefined);
  }, [ensurePlayer]);

  /** Queues a reply for speech. Text with nothing speakable is ignored. Returns whether it was queued. */
  const enqueue = useCallback(
    (text: string): boolean => {
      const chunks = splitSpeechChunks(cleanSpeechText(text));
      if (chunks.length === 0) return false;
      if (!abortRef.current) abortRef.current = new AbortController();
      const signal = abortRef.current.signal;
      // Every chunk is requested now (a few small calls); playback order is the queue order.
      for (const chunk of chunks) {
        const audio = fetch("/api/ego/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: chunk }),
          signal,
        })
          .then((res) => (res.ok ? res.arrayBuffer() : null))
          .catch(() => null);
        queueRef.current.push({ audio });
      }
      void pump();
      return true;
    },
    [pump]
  );

  /** Whether anything is playing or waiting to play. */
  const isActive = useCallback(() => playingRef.current || queueRef.current.length > 0, []);

  /**
   * Stops playback and drops anything queued; does nothing when EGO is not speaking.
   * `settle: false` leaves a thinking avatar thinking (a server turn is still running).
   */
  const stop = useCallback((opts?: { settle?: boolean }) => {
    if (!playingRef.current && queueRef.current.length === 0) return;
    generationRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    queueRef.current = [];
    playingRef.current = false;
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    stopLevel();
    startedRef.current = false;
    dispatchRef.current({ type: "speech_interrupted" });
    if (opts?.settle !== false) dispatchRef.current({ type: "speech_abandoned" });
  }, [stopLevel]);

  useEffect(() => {
    const generation = generationRef;
    const abort = abortRef;
    const timer = timerRef;
    const player = playerRef;
    return () => {
      generation.current++;
      abort.current?.abort();
      clearInterval(timer.current);
      void player.current?.ctx.close().catch(() => undefined);
      player.current = null;
    };
  }, []);

  return { levelRef, enqueue, isActive, stop, unlock };
}
