import type { FormattedChatTurn } from "@/lib/chat-history";

export type ConversationMessage = { role: "user" | "assistant"; content: string };

/** The incoming message is logged to chat history before routing, so it is often the last turn. */
export function dropCurrentTurn(history: FormattedChatTurn[], text: string): FormattedChatTurn[] {
  const last = history[history.length - 1];
  return last?.role === "user" && last.text === text ? history.slice(0, -1) : history;
}

/**
 * Only incoming messages are logged, never the bot's replies, so history is a run of
 * user turns. Sent as separate messages, providers merge them into one and the model
 * answers all of them again. Earlier turns go in as labelled context inside the single
 * final user message, so only the current message is acted on.
 */
export function toConversationMessages(
  history: FormattedChatTurn[],
  text: string
): ConversationMessage[] {
  const prior = dropCurrentTurn(history, text).filter((turn) => turn.text);
  if (prior.length === 0) return [{ role: "user", content: text }];

  const lines = prior.map((turn) => `- ${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`);
  return [
    {
      role: "user",
      content: [
        "Earlier messages in this chat, oldest first. They were already handled. They are only context for words like \"it\" or \"that\"; do not act on them or answer them again.",
        ...lines,
        "",
        "Current message (the only one to act on):",
        text,
      ].join("\n"),
    },
  ];
}
