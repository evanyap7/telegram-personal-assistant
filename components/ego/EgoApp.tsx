"use client";

import Avatar from "./Avatar";
import Composer from "./Composer";
import Conversation from "./Conversation";
import PushToggle from "./PushToggle";
import { useEgoChat } from "./useEgoChat";

export default function EgoApp() {
  const { messages, send, sendVoice, pressButton, avatar, dispatchAvatar, levelRef, speakerOn, setSpeakerOn, stopSpeech, unlockSpeech, busy, toast } =
    useEgoChat();
  return (
    <main className="ego-app">
      <PushToggle />
      <button
        type="button"
        className="ego-push-btn ego-speaker"
        aria-pressed={speakerOn}
        onClick={() => setSpeakerOn(!speakerOn)}
      >
        {speakerOn ? "Voice replies on" : "Voice replies off"}
      </button>
      <Avatar state={avatar} levelRef={levelRef} onTap={stopSpeech} />
      <Conversation messages={messages} busy={busy} onPress={pressButton} />
      <Composer busy={busy} onSend={send} onVoice={sendVoice} dispatchAvatar={dispatchAvatar} onGesture={unlockSpeech} />
      <div className="ego-toast" role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
