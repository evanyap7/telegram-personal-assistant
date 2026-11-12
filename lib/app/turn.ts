import crypto from "node:crypto";
import type { InputMode } from "../agent/input-mode";
import { runInChannel, type OutputChannel, type TelegramParseMode } from "../channel";
import type { InlineKeyboardMarkup } from "../telegram";
import type { EgoTurn } from "../telegram/ego-turn";
import type { AppButton, AppEvent } from "./events";

/** Telegram update ids are far below this, so app ids live in their own range. */
const APP_UPDATE_ID_BASE = 1e13;

/**
 * Deterministic update id for an app request: 1e13 plus the first five bytes of
 * SHA-256(requestId). Five bytes (< 1.1e12) keeps the sum a safe integer.
 */
export function appUpdateId(requestId: string): number {
  const digest = crypto.createHash("sha256").update(requestId).digest();
  return APP_UPDATE_ID_BASE + digest.readUIntBE(0, 5);
}

export interface AppTurnDeps {
  alreadyProcessed(id: number): Promise<boolean>;
  markStarted(id: number): Promise<void>;
  markCompleted(id: number, status: string): Promise<void>;
  markFailed(id: number, message: string): Promise<void>;
  turn(t: EgoTurn): Promise<{ completionStatus?: string }>;
  logUserMessage(text: string, inputMode: InputMode, requestId: string): Promise<void>;
}

function toButtons(markup?: InlineKeyboardMarkup): AppButton[][] | undefined {
  if (!markup?.inline_keyboard?.length) return undefined;
  return markup.inline_keyboard.map((row) =>
    row.map((b) => ({ text: b.text, data: b.callback_data }))
  );
}

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

/**
 * Telegram HTML parse mode -> plain text. Tags are dropped and the entities Telegram
 * supports are decoded (in one pass, so "&amp;lt;" stays "&lt;").
 */
function stripTelegramHtml(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/&(?:lt|gt|quot|#39|nbsp|amp);/g, (m) => HTML_ENTITIES[m]);
}

function plainText(text: string, parseMode?: TelegramParseMode): string {
  return parseMode === "HTML" ? stripTelegramHtml(text) : text;
}

function log(event: string, values: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...values }));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An OutputChannel that turns diverted Telegram sends into app events. Message ids
 * increment from `firstMessageId` (default: time-seeded, so ids from separate turns do
 * not collide in the client). After `close()` every method is a silent no-op, and a sink
 * that throws (for example a closed stream controller) never breaks the turn.
 */
export function createAppChannel(
  emit: (e: AppEvent) => void,
  firstMessageId: number = Date.now() * 1000
): OutputChannel & { close(): void } {
  let closed = false;
  let nextId = firstMessageId;
  const safeEmit = (e: AppEvent) => {
    if (closed) return;
    try {
      emit(e);
    } catch (err) {
      log("app.channel.emit_failed", { type: e.type, error: errorText(err) });
    }
  };
  return {
    send(text, markup, parseMode) {
      const id = nextId++;
      safeEmit({ type: "message", id, text: plainText(text, parseMode), buttons: toButtons(markup) });
      return id;
    },
    edit(messageId, text, markup, parseMode) {
      safeEmit({ type: "edit", id: messageId, text: plainText(text, parseMode), buttons: toButtons(markup) });
    },
    removeKeyboard(messageId) {
      safeEmit({ type: "buttons_removed", id: messageId });
    },
    answerCallback(text) {
      safeEmit({ type: "toast", text });
    },
    document(filename, content, caption) {
      safeEmit({ type: "document", filename, content, caption });
    },
    action() {
      safeEmit({ type: "thinking" });
    },
    close() {
      closed = true;
    },
  };
}

/** The generic, detail-free message an app error event carries. */
export const ERROR_REPLY = "Something went wrong on my side. Please try again.";

/**
 * Runs one app turn and streams its events. Mirrors the Telegram webhook: dedupe on the
 * update log, mark started, log the user message, run the EGO turn, mark completed or
 * failed. Never throws; failures end the stream with an `error` event.
 */
export async function runAppTurn(
  deps: AppTurnDeps,
  input: { text: string; inputMode: InputMode; requestId: string },
  emit: (e: AppEvent) => void
): Promise<void> {
  const updateId = appUpdateId(input.requestId);
  const ownerId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);

  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    log("app.turn.misconfigured", { updateId, error: "TELEGRAM_ALLOWED_USER_ID is missing." });
    emitSafely(emit, { type: "error", message: ERROR_REPLY });
    return;
  }

  const channel = createAppChannel(emit);

  // Immediate feedback, like the Telegram route's typing action.
  emitSafely(emit, { type: "thinking" });

  let started = false;
  try {
    if (await deps.alreadyProcessed(updateId)) {
      log("app.turn.duplicate_skipped", { updateId });
      channel.close();
      emitSafely(emit, { type: "done", status: "duplicate" });
      return;
    }

    await deps.markStarted(updateId);
    started = true;

    void Promise.resolve()
      .then(() => deps.logUserMessage(input.text, input.inputMode, input.requestId))
      .catch((err) => log("app.turn.log_user_failed", { updateId, error: errorText(err) }));

    const result = await runInChannel(channel, () =>
      deps.turn({
        chatId: ownerId,
        userId: ownerId,
        updateId,
        text: input.text,
        inputMode: input.inputMode,
        date: new Date(),
      })
    );
    channel.close();

    if (result.completionStatus) {
      try {
        await deps.markCompleted(updateId, result.completionStatus);
      } catch (err) {
        // The reply is already delivered; a failed bookkeeping write must not turn it into an error.
        log("app.turn.mark_completed_failed", { updateId, error: errorText(err) });
      }
    }
    emitSafely(emit, { type: "done", status: result.completionStatus });
  } catch (err) {
    channel.close();
    log("app.turn.failed", { updateId, started, error: errorText(err) });
    // Only a started update gets a failed row: a row makes the id count as processed, so
    // writing one after a failed dedupe read would block a retry of a turn that never ran.
    if (started) {
      try {
        await deps.markFailed(updateId, errorText(err));
      } catch (markErr) {
        log("app.turn.mark_failed_failed", { updateId, error: errorText(markErr) });
      }
    }
    emitSafely(emit, { type: "error", message: ERROR_REPLY });
  }
}

/** Emits a runner-level event, ignoring a sink that throws (the client has gone). */
function emitSafely(emit: (e: AppEvent) => void, e: AppEvent): void {
  try {
    emit(e);
  } catch (err) {
    log("app.turn.emit_failed", { type: e.type, error: errorText(err) });
  }
}
