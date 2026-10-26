import { deleteMemory, getMemoryByKey, saveMemory } from "../memory";
import { sendTelegramMessage } from "../telegram";
import { getDayPlan } from "./ph3-program";
import {
  buildSetPrompt,
  buildWorkoutActiveInlineKeyboard,
  loadSession,
  type WorkoutSessionState,
} from "./workout-session";

const MEMORY_TIMER_KEY = "ph3_rest_timer";

/**
 * A cron run waits out a timer due within this window, so pings land close to on time despite
 * per-minute polling. Kept well under cron-job.org's 30 s request timeout, which has to cover the
 * wait plus the Sheets and Telegram calls.
 */
export const REST_TIMER_LOOKAHEAD_MS = 20_000;

export interface RestTimer {
  chatId: number;
  seconds: number;
  /** Epoch ms when the rest is over. */
  dueAt: number;
  /** The set the user was resting before; if the cursor has moved on by the time it fires, the ping is skipped. */
  day: number;
  exIdx: number;
  setIdx: number;
}

export async function startRestTimer(
  chatId: number,
  seconds: number,
  session: Pick<WorkoutSessionState, "day" | "exIdx" | "setIdx">
): Promise<RestTimer> {
  const timer: RestTimer = {
    chatId,
    seconds,
    dueAt: Date.now() + seconds * 1000,
    day: session.day,
    exIdx: session.exIdx,
    setIdx: session.setIdx,
  };
  await saveMemory({
    category: "preference",
    key: MEMORY_TIMER_KEY,
    value: JSON.stringify(timer),
    tags: ["ph3", "workout", "timer"],
  });
  return timer;
}

export async function clearRestTimer(): Promise<void> {
  await deleteMemory(MEMORY_TIMER_KEY);
}

async function loadRestTimer(): Promise<RestTimer | null> {
  const record = await getMemoryByKey(MEMORY_TIMER_KEY, "preference");
  if (!record?.value) return null;
  try {
    const parsed = JSON.parse(record.value) as RestTimer;
    return typeof parsed.dueAt === "number" && typeof parsed.chatId === "number" ? parsed : null;
  } catch {
    return null;
  }
}

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

  await clearRestTimer();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  const session = await loadSession();
  const moved =
    !session ||
    session.day !== timer.day ||
    session.exIdx !== timer.exIdx ||
    session.setIdx !== timer.setIdx;
  if (moved) return "skipped";

  const plan = await getDayPlan(session.day);
  await sendTelegramMessage(
    timer.chatId,
    ["⏱ *Rest is over — you're up.*", "", buildSetPrompt(plan, session.exIdx, session.setIdx)].join("\n"),
    buildWorkoutActiveInlineKeyboard()
  );
  return "sent";
}
