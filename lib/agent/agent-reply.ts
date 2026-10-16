export type AgentReplyDecision = { kind: "decline" } | { kind: "send"; text: string };

/**
 * Decides what a sub-agent (finance, workout) should do with its final text.
 * A request the agent changed data for is NEVER reported as "not handled", even if the
 * model ended with no text or the decline sentinel; the user gets a plain "Done.".
 */
export function resolveAgentReply(input: {
  reply: string;
  mutated: boolean;
  sentinel: string;
}): AgentReplyDecision {
  const reply = input.reply.trim();
  const empty = reply === "" || reply === input.sentinel;
  if (empty) {
    return input.mutated ? { kind: "send", text: "Done." } : { kind: "decline" };
  }
  return { kind: "send", text: reply };
}
