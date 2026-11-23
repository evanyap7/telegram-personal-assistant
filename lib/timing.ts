export type TimingStage = "dedupe" | "history" | "model_call" | "sheets_write";

export interface TimingEvent {
  event: "stage_timing";
  stage: TimingStage;
  durationMs: number;
  timestamp: string;
  [key: string]: unknown;
}

export function logTiming(
  stage: TimingStage,
  durationMs: number,
  meta?: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      event: "stage_timing",
      stage,
      durationMs,
      timestamp: new Date().toISOString(),
      ...(meta ?? {}),
    })
  );
}

export async function timeStage<T>(
  stage: TimingStage,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    logTiming(stage, Date.now() - start, meta);
  }
}
