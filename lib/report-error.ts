import { sendTelegramMessage } from "@/lib/telegram";

// Same-key reports are suppressed for this long so a failing cron can't spam the owner.
export const REPORT_COOLDOWN_MS = 10 * 60_000;
const MAX_DETAIL_LENGTH = 300;

const lastReportedAt = new Map<string, number>();

export function shouldReport(key: string, now: number = Date.now()): boolean {
  const last = lastReportedAt.get(key);
  if (last !== undefined && now - last < REPORT_COOLDOWN_MS) return false;
  lastReportedAt.set(key, now);
  return true;
}

export function resetReportThrottle(): void {
  lastReportedAt.clear();
}

export function formatErrorReport(event: string, error: unknown, extra?: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = raw.length > MAX_DETAIL_LENGTH ? `${raw.slice(0, MAX_DETAIL_LENGTH)}…` : raw;
  return `🚨 ${event}${extra ? ` (${extra})` : ""}\n${detail}`;
}

/**
 * Best-effort DM to the owner so failures stop being log-only. Never throws, and is throttled
 * per event (in-memory, so per serverless instance: a safety valve, not a global guarantee).
 */
export async function reportError(event: string, error: unknown, extra?: string): Promise<void> {
  try {
    const ownerId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
    if (!ownerId || !shouldReport(event)) return;
    await sendTelegramMessage(ownerId, formatErrorReport(event, error, extra), undefined, null);
  } catch (reportFailure) {
    console.error("report_error.failed", reportFailure);
  }
}
