import { deleteMemory, getMemoryByKey, saveMemory } from "../memory";

const MEMORY_TIMER_KEY = "ph3_rest_timer";

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
  session: { day: number; exIdx: number; setIdx: number }
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

export async function loadRestTimer(): Promise<RestTimer | null> {
  const record = await getMemoryByKey(MEMORY_TIMER_KEY, "preference");
  if (!record?.value) return null;
  try {
    const parsed = JSON.parse(record.value) as RestTimer;
    return typeof parsed.dueAt === "number" && typeof parsed.chatId === "number" ? parsed : null;
  } catch {
    return null;
  }
}
