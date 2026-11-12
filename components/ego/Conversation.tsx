"use client";

import { useEffect, useRef } from "react";
import { parseInlineMarkdown } from "@/lib/app/markdown";
import type { ChatMessage } from "./useEgoChat";

function Rich({ text }: { text: string }) {
  return (
    <>
      {parseInlineMarkdown(text).map((s, i) => {
        if (s.kind === "bold") return <b key={i}>{s.text}</b>;
        if (s.kind === "italic") return <i key={i}>{s.text}</i>;
        if (s.kind === "code") return <code key={i}>{s.text}</code>;
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Conversation({
  messages,
  busy,
  onPress,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onPress(messageId: number, data: string): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <section className="ego-chat" aria-label="Conversation" role="log" aria-live="polite">
      {messages.length === 0 && <p className="ego-empty">Ask me anything, or tell me what you spent.</p>}
      {messages.map((m) => (
        <div key={m.key} className={`ego-msg ${m.role === "user" ? "me" : "bot"}`}>
          <div className="ego-text">
            <Rich text={m.text} />
          </div>
          {m.document && (
            <div className="ego-btns">
              <button type="button" onClick={() => download(m.document!.filename, m.document!.content)}>
                Download {m.document.filename}
              </button>
            </div>
          )}
          {m.id !== undefined &&
            m.buttons?.map((row, r) => (
              <div className="ego-btns" key={r}>
                {row.map((b) => (
                  <button key={b.data} type="button" disabled={busy} onClick={() => onPress(m.id!, b.data)}>
                    {b.text}
                  </button>
                ))}
              </div>
            ))}
        </div>
      ))}
      <div ref={endRef} />
    </section>
  );
}
