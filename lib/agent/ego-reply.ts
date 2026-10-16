/** The orchestrator replies with this when tools already told the user everything. */
export const NO_REPLY = "NO_REPLY";

export const FALLBACK_REPLY =
  "I'm not sure how to help with that. Try /help to see what I can do.";

export const PARTIAL_FAILURE_REPLY =
  "I did part of that, but hit a problem before I could finish. Please check before repeating it so nothing gets done twice.";

/**
 * When the model run fails: if a tool already messaged the user, something may have been
 * done, so send a "check first" note instead of a generic "try again" (which invites a
 * duplicate). Null means nothing was done yet and the caller should surface the error.
 */
export function resolveFailureReply(notified: boolean): string | null {
  return notified ? PARTIAL_FAILURE_REPLY : null;
}

export interface ReplyTracker {
  /** Called whenever a tool, handler or sub-agent has sent the user a message. */
  markNotified(): void;
  readonly notified: boolean;
}

export function createReplyTracker(): ReplyTracker {
  let notified = false;
  return {
    markNotified() {
      notified = true;
    },
    get notified() {
      return notified;
    },
  };
}

/**
 * Decides what the orchestrator's final text should send. Returns null when
 * nothing should be sent (tools already messaged the user and the model had
 * nothing to add). Never returns null when the user has heard nothing yet.
 */
export function resolveFinalReply(input: { text: string; notified: boolean }): string | null {
  const text = input.text.replace(/\bNO_REPLY\b\.?/g, "").trim();
  if (text === "") {
    return input.notified ? null : FALLBACK_REPLY;
  }
  return text;
}
