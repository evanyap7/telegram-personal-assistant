"use client";

import Avatar from "./Avatar";
import Composer from "./Composer";
import Conversation from "./Conversation";
import { useEgoChat } from "./useEgoChat";

export default function EgoApp() {
  const { messages, send, pressButton, avatar, busy, toast } = useEgoChat();
  return (
    <main className="ego-app">
      <Avatar state={avatar} />
      <Conversation messages={messages} busy={busy} onPress={pressButton} />
      <Composer busy={busy} onSend={send} />
      <div className="ego-toast" role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
