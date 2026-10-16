import type { InputMode } from "@/lib/agent/input-mode";
import { runEgo } from "@/lib/agent/ego-orchestrator";
import { getRecentChatHistory } from "@/lib/chat-history";
import { getLatestTransaction } from "@/lib/finance";
import { resolveRepliedTransaction } from "@/lib/handlers/finance-handler";
import { getLatestPendingImage, getLatestUserCalendarContext } from "@/lib/pending-actions";
import { dispatchCommand } from "@/lib/telegram/command-router";
import type { TelegramUpdate } from "@/lib/telegram-types";
import {
  handleStrictSetShortcut,
  handleWorkoutSessionMessage,
} from "@/lib/workout/workout-session";

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

/**
 * EGO-mode handling of one text message (typed, a photo caption, or a voice transcript).
 * Photo/voice intake, auth, dedupe and callbacks stay in the route.
 */
export async function handleEgoText(params: {
  message: TelegramMessage;
  chatId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
}): Promise<{ completionStatus?: string }> {
  const { message, chatId, updateId, text, inputMode } = params;
  const userId = message.from.id;

  // Workout slash commands (/gym, /endworkout, /workoutday ...) are deterministic.
  if (text.startsWith("/") && (await handleWorkoutSessionMessage({ chatId, text }))) {
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

  const replyPhotos = message.reply_to_message?.photo;
  const [history, userCalendarContext, latestTxn, repliedTxn, pendingImage] = await Promise.all([
    getRecentChatHistory(userId, 8),
    getLatestUserCalendarContext(userId),
    getLatestTransaction(),
    message.reply_to_message
      ? resolveRepliedTransaction(message.reply_to_message)
      : Promise.resolve(null),
    replyPhotos?.length ? Promise.resolve(null) : getLatestPendingImage(userId),
  ]);

  const result = await runEgo({
    chatId,
    userId,
    updateId,
    text,
    inputMode,
    messageDate: message.date ? new Date(message.date * 1000) : new Date(),
    history,
    userCalendarContext,
    targetTransaction: repliedTxn || latestTxn,
    repliedToText: message.reply_to_message?.text,
    repliedPhotoFileIds: replyPhotos?.length
      ? [replyPhotos[replyPhotos.length - 1].file_id]
      : undefined,
    hasPendingImage: Boolean(pendingImage),
  });
  return { completionStatus: result.completionStatus };
}
