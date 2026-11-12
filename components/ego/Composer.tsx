"use client";

import { useEffect, useRef, useState } from "react";

export default function Composer({ busy, onSend }: { busy: boolean; onSend(text: string): void }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the keyboard up: when a turn ends and focus fell to the page, return it to the field.
  useEffect(() => {
    if (!busy && document.activeElement === document.body) inputRef.current?.focus();
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
        // Hold-to-talk is wired up in a later task; inert until then.
        <button className="ego-round" type="button" disabled aria-label="Hold to talk (coming soon)">
          Hold
        </button>
      )}
    </form>
  );
}
