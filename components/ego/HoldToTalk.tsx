"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvatarEvent } from "@/lib/app/avatar-state";
import { VOICE_MIN_SAMPLES_16K, VOICE_SAMPLE_RATE, downsample, encodeWav } from "@/lib/app/audio";
import { RecorderError, startRecording, type Recording } from "./recorder";

/** Auto-stop, so a stuck button cannot record past the upload cap (60 s is about 1.9 MB). */
const MAX_HOLD_MS = 60_000;

export default function HoldToTalk({
  disabled,
  onVoice,
  dispatchAvatar,
}: {
  disabled: boolean;
  onVoice(audio: Blob): void;
  dispatchAvatar(e: AvatarEvent): void;
}) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // "idle" -> "starting" (mic opening) -> "recording"; a release during "starting" is remembered.
  const phase = useRef<"idle" | "starting" | "recording">("idle");
  const releasedEarly = useRef(false);
  const active = useRef<Recording | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  const hint = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 4000);
  }, []);

  const finish = useCallback(
    async (rec: Recording) => {
      clearTimeout(maxTimer.current);
      phase.current = "idle";
      active.current = null;
      setRecording(false);
      dispatchAvatar({ type: "listen_end" });
      try {
        const { samples, sampleRate } = await rec.stop();
        const pcm = downsample(samples, sampleRate, VOICE_SAMPLE_RATE);
        if (pcm.length < VOICE_MIN_SAMPLES_16K) {
          if (mounted.current) hint("Hold the button a little longer while you speak.");
          return;
        }
        const wav = encodeWav(pcm, VOICE_SAMPLE_RATE);
        onVoice(new Blob([wav as BlobPart], { type: "audio/wav" }));
      } catch {
        if (mounted.current) hint("Recording failed. Please try again.");
      }
    },
    [dispatchAvatar, hint, onVoice]
  );

  const begin = useCallback(async () => {
    if (disabled || phase.current !== "idle") return;
    phase.current = "starting";
    releasedEarly.current = false;
    setMessage(null);
    let rec: Recording;
    try {
      rec = await startRecording();
    } catch (err) {
      phase.current = "idle";
      if (!mounted.current) return;
      hint(
        err instanceof RecorderError && err.code === "denied"
          ? "Microphone access is blocked. Allow it in your browser settings to talk to EGO."
          : err instanceof RecorderError && err.code === "unsupported"
            ? "Voice input is not supported in this browser."
            : "I could not open the microphone."
      );
      return;
    }
    if (!mounted.current) {
      rec.cancel();
      phase.current = "idle";
      return;
    }
    active.current = rec;
    if (releasedEarly.current) {
      // Let go before the microphone opened: too short to be useful.
      phase.current = "idle";
      active.current = null;
      rec.cancel();
      hint("Hold the button a little longer while you speak.");
      return;
    }
    phase.current = "recording";
    setRecording(true);
    dispatchAvatar({ type: "listen_start" });
    maxTimer.current = setTimeout(() => void finish(rec), MAX_HOLD_MS);
  }, [disabled, dispatchAvatar, finish, hint]);

  const end = useCallback(() => {
    if (phase.current === "starting") releasedEarly.current = true;
    else if (phase.current === "recording" && active.current) void finish(active.current);
  }, [finish]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(maxTimer.current);
      clearTimeout(messageTimer.current);
      if (active.current) {
        // Unmounted mid-hold (the field switched to Send): drop the audio, settle the avatar.
        active.current.cancel();
        active.current = null;
        dispatchAvatar({ type: "listen_end" });
      }
    };
  }, [dispatchAvatar]);

  return (
    <>
      <button
        className={`ego-round${recording ? " ego-recording" : ""}`}
        type="button"
        disabled={disabled}
        aria-label={recording ? "Release to send" : "Hold to talk"}
        aria-pressed={recording}
        style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          void begin();
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === " " && !e.repeat) {
            e.preventDefault();
            void begin();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " ") {
            e.preventDefault();
            end();
          }
        }}
        onBlur={end}
      >
        {recording ? "Release" : "Hold"}
      </button>
      {message ? (
        <div className="ego-voice-hint" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </>
  );
}
