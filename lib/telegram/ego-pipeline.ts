import type { InputMode } from "@/lib/agent/input-mode";
import { runEgo } from "@/lib/agent/ego-orchestrator";
import { getRecentChatHistory } from "@/lib/chat-history";
import { getLatestTransaction } from "@/lib/finance";
import { resolveRepliedTransaction } from "@/lib/handlers/finance-handler";
import { getLatestPendingImage, getLatestUserCalendarContext } from "@/lib/pending-actions";
import { dispatchCommand } from "@/lib/telegram/command-router";
import { egoTurnFromMessage, type EgoTurn } from "@/lib/telegram/ego-turn";
import type { TelegramUpdate } from "@/lib/telegram-types";
import {
  handleStrictSetShortcut,
  handleWorkoutSessionMessage,
  parseWorkoutDayCommand,
} from "@/lib/workout/workout-session";

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

export { egoTurnFromMessage, type EgoTurn };

/**
 * EGO-mode handling of one Telegram text message (typed, a photo caption, or a voice
 * transcript). Photo/voice intake, auth, dedupe and callbacks stay in the route.
 */
export async function handleEgoText(params: {
  message: TelegramMessage;
  chatId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
}): Promise<{ completionStatus?: string }> {
  return handleEgoTurn(egoTurnFromMessage(params));
}

/** Runs one EGO turn: deterministic commands and shortcuts first, then the orchestrator. */
export async function handleEgoTurn(turn: EgoTurn): Promise<{ completionStatus?: string }> {
  const { chatId, userId, updateId, text, inputMode, date, replyTo } = turn;

  // Workout slash commands (/gym, /endworkout, /workoutday ...) and plain-text day commands
  // ("next day", "set workout day 12") are deterministic. Left to the model, a day command with
  // no active session was routed to "start", which reloaded the saved day instead of moving it.
  if (
    (text.startsWith("/") || parseWorkoutDayCommand(text) !== null) &&
    (await handleWorkoutSessionMessage({ chatId, text }))
  ) {
    return { completionStatus: "workout_session" };
  }

  const commandResult = await dispatchCommand({ chatId, userId, updateId, text });
  if (commandResult.handled) {
    return { completionStatus: commandResult.completionStatus };
  }

  // The most frequent message in a workout skips the model entirely.
  if (await handleStrictSetShortcut({ chatId, text })) {
    return { completionStatus: "workout_set_shortcut" };
  }

  const replyPhotos = replyTo?.photo;
  const [history, userCalendarContext, latestTxn, repliedTxn, pendingImage] = await Promise.all([
    getRecentChatHistory(userId, 8),
    getLatestUserCalendarContext(userId),
    getLatestTransaction(),
    replyTo ? resolveRepliedTransaction(replyTo) : Promise.resolve(null),
    replyPhotos?.length ? Promise.resolve(null) : getLatestPendingImage(userId),
  ]);

  const result = await runEgo({
    chatId,
    userId,
    updateId,
    text,
    inputMode,
    messageDate: date,
    history,
    userCalendarContext,
    targetTransaction: repliedTxn || latestTxn,
    repliedToText: replyTo?.text,
    repliedPhotoFileIds: replyPhotos?.length
      ? [replyPhotos[replyPhotos.length - 1].file_id]
      : undefined,
    hasPendingImage: Boolean(pendingImage),
  });
  return { completionStatus: result.completionStatus };
}
