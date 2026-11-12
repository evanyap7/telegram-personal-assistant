"use client";

import Avatar from "./Avatar";
import Composer from "./Composer";
import Conversation from "./Conversation";
import PushToggle from "./PushToggle";
import { useEgoChat } from "./useEgoChat";

export default function EgoApp() {
  const { messages, send, sendVoice, pressButton, avatar, dispatchAvatar, busy, toast } = useEgoChat();
  return (
    <main className="ego-app">
      <PushToggle />
      <Avatar state={avatar} />
      <Conversation messages={messages} busy={busy} onPress={pressButton} />
      <Composer busy={busy} onSend={send} onVoice={sendVoice} dispatchAvatar={dispatchAvatar} />
      <div className="ego-toast" role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
