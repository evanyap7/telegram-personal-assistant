import type { InputMode } from "../agent/input-mode";
import { logChatMessage } from "../chat-history";
import {
  hasProcessedUpdate,
  markUpdateCompleted,
  markUpdateFailed,
  markUpdateStarted,
} from "../finance";
import { handleEgoTurn } from "../telegram/ego-pipeline";
import { appUpdateId, type AppTurnDeps } from "./turn";

// Production wiring for runAppTurn, kept apart from turn.ts so offline tests can load
// the runner without the whole EGO pipeline.

/**
 * Logs an app user message to the shared ChatHistory, the same way the Telegram route
 * logs incoming text. Telegram does not log assistant replies, so neither does the app.
 * The synthetic message id (>= 1e13) cannot collide with a Telegram message id.
 */
export async function logAppUserMessage(
  text: string,
  inputMode: InputMode,
  requestId: string
): Promise<void> {
  await logChatMessage({
    messageId: appUpdateId(requestId),
    userId: Number(process.env.TELEGRAM_ALLOWED_USER_ID),
    role: "user",
    text,
    actionType: inputMode === "voice" ? "voice_transcribed" : "incoming_text",
  });
}

/** Production wiring: the same update log and EGO pipeline the Telegram route uses. */
export const appTurnDeps: AppTurnDeps = {
  alreadyProcessed: hasProcessedUpdate,
  markStarted: markUpdateStarted,
  markCompleted: markUpdateCompleted,
  markFailed: markUpdateFailed,
  turn: handleEgoTurn,
  logUserMessage: logAppUserMessage,
};
