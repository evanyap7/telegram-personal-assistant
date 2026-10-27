import { sendTelegramMessage } from "../telegram";
import { getDayPlan } from "./ph3-program";
import { clearRestTimer, loadRestTimer } from "./rest-timer-store";
import { buildSetPrompt, buildWorkoutActiveInlineKeyboard, loadSession } from "./workout-session";

/**
 * A cron run waits out a timer due within this window, so pings land close to on time despite
 * per-minute polling. Kept well under cron-job.org's 30 s request timeout, which has to cover the
 * wait plus the Sheets and Telegram calls.
 */
export const REST_TIMER_LOOKAHEAD_MS = 15_000;

export type RestTimerResult = "none" | "pending" | "sent" | "skipped";

/**
 * Called by the per-minute cron. Sends the "rest is over" message for a due timer, waiting out
 * the last few seconds when it is due before the next poll. The timer is deleted before the
 * message goes out so overlapping cron runs can't ping twice.
 */
export async function fireDueRestTimer(): Promise<RestTimerResult> {
  const timer = await loadRestTimer();
  if (!timer) return "none";

  const wait = timer.dueAt - Date.now();
  if (wait > REST_TIMER_LOOKAHEAD_MS) return "pending";

  // The slow Sheets plan fetch runs during the wait instead of after it, so the time left once
  // the timer is due only has to cover loadSession and the Telegram send.
  const planPromise = getDayPlan(timer.day);
  planPromise.catch(() => {});
  await clearRestTimer();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  const session = await loadSession();
  const moved =
    !session ||
    session.day !== timer.day ||
    session.exIdx !== timer.exIdx ||
    session.setIdx !== timer.setIdx;
  if (moved) return "skipped";

  const plan = await planPromise;
  await sendTelegramMessage(
    timer.chatId,
    ["⏱ *Rest is over — you're up.*", "", buildSetPrompt(plan, session.exIdx, session.setIdx)].join("\n"),
    buildWorkoutActiveInlineKeyboard()
  );
  return "sent";
}
