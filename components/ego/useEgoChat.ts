"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initialAvatarState, reduceAvatar, type AvatarEvent, type AvatarState } from "@/lib/app/avatar-state";
import type { AppButton, AppEvent } from "@/lib/app/events";
import { readSse } from "@/lib/app/sse-client";

export interface ChatMessage {
  /** Stable React key. */
  key: string;
  /** The server message id, present on EGO messages; the target of edits and button presses. */
  id?: number;
  role: "user" | "ego";
  text: string;
  buttons?: AppButton[][];
  document?: { filename: string; content: string };
}

export interface EgoChat {
  messages: ChatMessage[];
  send(text: string): void;
  sendVoice(audio: Blob): void;
  pressButton(messageId: number, data: string): void;
  avatar: AvatarState;
  dispatchAvatar(e: AvatarEvent): void;
  busy: boolean;
  toast: string | null;
}

const MOOD_DECAY_MS = 8000;

/** A fresh id per chat message or button press; matches /^[A-Za-z0-9_-]{8,128}$/. */
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function useEgoChat(): EgoChat {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [avatar, dispatchAvatar] = useReducer(reduceAvatar, initialAvatarState);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const busyRef = useRef(false);
  const localKey = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearTimeout(toastTimer.current);
    };
  }, []);

  // Smile (or wince) for a few seconds after a turn, then settle back to neutral.
  useEffect(() => {
    if (avatar.mood === "neutral" || avatar.mood === "focused" || avatar.activity !== "idle") return;
    const t = setTimeout(() => dispatchAvatar({ type: "mood_decay" }), MOOD_DECAY_MS);
    return () => clearTimeout(t);
  }, [avatar.mood, avatar.activity]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const handle = useCallback(
    (e: AppEvent) => {
      switch (e.type) {
        case "thinking":
          // Emitted more than once per turn; request_sent is idempotent.
          dispatchAvatar({ type: "request_sent" });
          break;
        case "transcript":
          // What the server heard becomes the user's message, ahead of EGO's reply.
          if (e.text) setMessages((m) => [...m, { key: `u-${++localKey.current}`, role: "user", text: e.text }]);
          break;
        case "message":
          setMessages((m) =>
            m.some((x) => x.id === e.id)
              ? m
              : [...m, { key: `e-${e.id}`, id: e.id, role: "ego", text: e.text, buttons: e.buttons }]
          );
          break;
        case "edit":
          setMessages((m) => m.map((x) => (x.id === e.id ? { ...x, text: e.text, buttons: e.buttons } : x)));
          break;
        case "buttons_removed":
          setMessages((m) => m.map((x) => (x.id === e.id ? { ...x, buttons: undefined } : x)));
          break;
        case "toast":
          if (e.text) showToast(e.text);
          break;
        case "document": {
          const key = `d-${++localKey.current}`;
          setMessages((m) => [
            ...m,
            { key, role: "ego", text: e.caption ?? e.filename, document: { filename: e.filename, content: e.content } },
          ]);
          break;
        }
        case "error":
          setMessages((m) => [...m, { key: `x-${++localKey.current}`, role: "ego", text: e.message }]);
          dispatchAvatar({ type: "turn_error" });
          break;
        case "done":
          dispatchAvatar({ type: "turn_done", status: e.status });
          break;
        default:
          break;
      }
    },
    [showToast]
  );

  const run = useCallback(
    async (url: string, payload: Record<string, unknown> | FormData) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      dispatchAvatar({ type: "request_sent" });
      const controller = new AbortController();
      abortRef.current = controller;
      let finished = false;
      const fail = (text: string) => {
        finished = true;
        setMessages((m) => [...m, { key: `x-${++localKey.current}`, role: "ego", text }]);
        dispatchAvatar({ type: "turn_error" });
      };
      try {
        const requestId = newRequestId();
        let init: RequestInit;
        if (payload instanceof FormData) {
          payload.append("requestId", requestId);
          // No content-type: the browser adds the multipart boundary.
          init = { method: "POST", body: payload };
        } else {
          init = {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, requestId }),
          };
        }
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (res.status === 401) {
          finished = true;
          dispatchAvatar({ type: "turn_error" });
          router.replace("/ego/login");
          return;
        }
        if (res.status === 403) {
          // A valid session but a refused origin; /ego/login would bounce straight back.
          fail("The server refused that request. Reload the page and try again.");
          return;
        }
        if (!res.ok || !res.body) {
          fail("That did not go through. Please try again.");
          return;
        }
        await readSse(res.body, (e) => {
          if (e.type === "done" || e.type === "error") finished = true;
          handle(e);
        });
        if (!finished) fail("The connection dropped before I finished. Please try again.");
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) fail("I could not reach the server. Please try again.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [handle, router]
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;
      setMessages((m) => [...m, { key: `u-${++localKey.current}`, role: "user", text: trimmed }]);
      void run("/api/ego/chat", { text: trimmed });
    },
    [run]
  );

  const sendVoice = useCallback(
    (audio: Blob) => {
      if (busyRef.current) return;
      const form = new FormData();
      form.append("audio", audio, "voice.wav");
      void run("/api/ego/voice", form);
    },
    [run]
  );

  const pressButton = useCallback(
    (messageId: number, data: string) => {
      void run("/api/ego/callback", { data, messageId });
    },
    [run]
  );

  return { messages, send, sendVoice, pressButton, avatar, dispatchAvatar, busy, toast };
}
