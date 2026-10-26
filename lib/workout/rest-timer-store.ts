import { deleteMemory, getMemoryByKey, saveMemory } from "../memory";
import { DEFAULT_REST_SECONDS, exerciseKind } from "./coach";

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

const MEMORY_CONFIG_KEY = "ph3_rest_config";

export interface RestConfig {
  /** Master switch for the timer that starts when a set is logged. Manual rest buttons always work. */
  enabled: boolean;
  main: number;
  compound: number;
  isolation: number;
}

export const DEFAULT_REST_CONFIG: RestConfig = { enabled: true, ...DEFAULT_REST_SECONDS };

export async function loadRestConfig(): Promise<RestConfig> {
  const record = await getMemoryByKey(MEMORY_CONFIG_KEY, "preference").catch(() => null);
  if (!record?.value) return DEFAULT_REST_CONFIG;
  try {
    const parsed = JSON.parse(record.value) as Partial<RestConfig>;
    const pick = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
    return {
      enabled: parsed.enabled !== false,
      main: pick(parsed.main, DEFAULT_REST_CONFIG.main),
      compound: pick(parsed.compound, DEFAULT_REST_CONFIG.compound),
      isolation: pick(parsed.isolation, DEFAULT_REST_CONFIG.isolation),
    };
  } catch {
    return DEFAULT_REST_CONFIG;
  }
}

export async function saveRestConfig(config: RestConfig): Promise<void> {
  await saveMemory({
    category: "preference",
    key: MEMORY_CONFIG_KEY,
    value: JSON.stringify(config),
    tags: ["ph3", "workout", "timer"],
  });
}

export async function resetRestConfig(): Promise<void> {
  await deleteMemory(MEMORY_CONFIG_KEY);
}

/** Seconds to rest after this exercise, or null when auto-start is switched off. */
export async function getAutoRestSeconds(exerciseName: string): Promise<number | null> {
  const config = await loadRestConfig();
  return config.enabled ? config[exerciseKind(exerciseName)] : null;
}
