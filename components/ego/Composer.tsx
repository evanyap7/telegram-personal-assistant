"use client";

import { useEffect, useRef, useState } from "react";
import type { AvatarEvent } from "@/lib/app/avatar-state";
import HoldToTalk from "./HoldToTalk";

export default function Composer({
  busy,
  onSend,
  onVoice,
  dispatchAvatar,
}: {
  busy: boolean;
  onSend(text: string): void;
  onVoice(audio: Blob): void;
  dispatchAvatar(e: AvatarEvent): void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Set when a typed message is sent, i.e. the field had focus when the turn started.
  const refocusAfterTurn = useRef(false);

  // Keep the keyboard up only for a typed turn: when it ends and focus fell to the page,
  // return it to the field. Never on mount, and not after a voice turn.
  useEffect(() => {
    if (busy) return;
    if (refocusAfterTurn.current && document.activeElement === document.body) inputRef.current?.focus();
    refocusAfterTurn.current = false;
  }, [busy]);

  const canSend = text.trim().length > 0 && !busy;
  return (
    <form
      className="ego-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) return;
        onSend(text);
        setText("");
        inputRef.current?.focus();
        refocusAfterTurn.current = true;
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Message EGO"
        aria-label="Message EGO"
        maxLength={4000}
        enterKeyHint="send"
        autoComplete="off"
      />
      {text.trim() ? (
        <button className="ego-round" type="submit" disabled={!canSend} aria-label="Send">
          Send
        </button>
      ) : (
        <HoldToTalk disabled={busy} onVoice={onVoice} dispatchAvatar={dispatchAvatar} />
      )}
    </form>
  );
}
