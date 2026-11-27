import { sendTelegramMessage } from "../telegram";
import { pushIfProactive } from "../app/push-default";
import { deleteMemoryRow, listAllMemories } from "../memory";
import { getDayPlan, MEMORY_SESSION_KEY } from "./ph3-program";
import { applyEdits } from "./plan-edits";
import { MEMORY_TIMER_KEY, parseRestTimer } from "./rest-timer-store";
import {
  buildSetPrompt,
  buildWorkoutActiveInlineKeyboard,
  parseWorkoutSession,
} from "./workout-session";

/**
 * A cron run waits out a timer due within this window, so pings land close to on time despite
 * per-minute polling. Kept small (5s) so the entire cron run finishes in under 6-8 seconds, well
 * clear of cron-job.org's 30 s request timeout.
 */
export const REST_TIMER_LOOKAHEAD_MS = 5_000;

export type RestTimerResult = "none" | "pending" | "sent" | "skipped";

/**
 * Called by the per-minute cron. Sends the "rest is over" message for a due timer, waiting out
 * the last few seconds when it is due before the next poll.
 *
 * Performance-critical:
 * 1. Reads the Memory sheet once to get both the timer and the session in a single round trip.
 * 2. Clears the timer row directly by row number (no re-fetching the sheet).
 * 3. Runs plan loading, timer row clearing, and sleep concurrently.
 */
export async function fireDueRestTimer(): Promise<RestTimerResult> {
  // Single round-trip to Google Sheets fetches all active memories (timer + session)
  const memories = await listAllMemories();
  const timerRecord = memories.find(
    (m) => m.key.toLowerCase() === MEMORY_TIMER_KEY.toLowerCase() && m.category === "preference"
  );
  if (!timerRecord?.value) return "none";

  const timer = parseRestTimer(timerRecord.value);
  if (!timer) return "none";

  const wait = timer.dueAt - Date.now();
  if (wait > REST_TIMER_LOOKAHEAD_MS) return "pending";

  // Parse session from the same memories fetch
  const sessionRecord = memories.find(
    (m) => m.key.toLowerCase() === MEMORY_SESSION_KEY.toLowerCase() && m.category === "preference"
  );
  const session = parseWorkoutSession(sessionRecord?.value);

  const moved =
    !session ||
    session.day !== timer.day ||
    session.exIdx !== timer.exIdx ||
    session.setIdx !== timer.setIdx;

  // Clear timer directly by row number and fetch the plan concurrently during the wait
  const clearPromise = deleteMemoryRow(timerRecord.rowNumber).catch((err) => {
    console.error("rest_timer.clear_failed", err);
    return false;
  });

  const planPromise = moved ? Promise.resolve(null) : getDayPlan(timer.day);
  planPromise.catch(() => {});

  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  await clearPromise;

  if (moved) return "skipped";

  const dayPlan = await planPromise;
  if (!dayPlan) return "skipped";

  const plan = applyEdits(dayPlan, session.edits ?? []);
  const restText = [
    "⏱ *Rest is over — you're up.*",
    "",
    buildSetPrompt(plan, session.exIdx, session.setIdx),
  ].join("\n");

  await sendTelegramMessage(timer.chatId, restText, buildWorkoutActiveInlineKeyboard());
  await pushIfProactive({ push: true }, "Rest is over", restText);
  return "sent";
}
