/**
 * Per-instance, in-memory load shedding for non-owner traffic. It runs before
 * any Sheets call so a hostile sender cannot burn the shared Sheets quota.
 * Imperfect across serverless instances by design; this is shedding only.
 */

const WINDOW_MS = 60_000;
const PER_SENDER_LIMIT = 10;
const GLOBAL_LIMIT = 60;
const BLOCKED_TTL_MS = 10 * 60_000;
const MAX_TRACKED = 5_000;

interface Window {
  startMs: number;
  count: number;
}

const senders = new Map<number, Window>();
let global: Window = { startMs: 0, count: 0 };
const blocked = new Map<number, number>(); // id -> expiry ms

function prune(nowMs: number): void {
  if (senders.size > MAX_TRACKED) {
    for (const [id, w] of senders) if (nowMs - w.startMs >= WINDOW_MS) senders.delete(id);
  }
  if (blocked.size > MAX_TRACKED) {
    for (const [id, exp] of blocked) if (exp <= nowMs) blocked.delete(id);
  }
}

/** True if this non-owner update should be dropped (200, no work). Counts it otherwise. */
export function shedGuestUpdate(senderId: number, nowMs: number = Date.now()): boolean {
  const exp = blocked.get(senderId);
  if (exp !== undefined) {
    if (exp > nowMs) return true;
    blocked.delete(senderId);
  }
  if (nowMs - global.startMs >= WINDOW_MS) global = { startMs: nowMs, count: 0 };
  let w = senders.get(senderId);
  if (!w || nowMs - w.startMs >= WINDOW_MS) w = { startMs: nowMs, count: 0 };
  if (w.count >= PER_SENDER_LIMIT || global.count >= GLOBAL_LIMIT) {
    senders.set(senderId, w);
    return true;
  }
  w.count += 1;
  global.count += 1;
  senders.set(senderId, w);
  prune(nowMs);
  return false;
}

export function markBlocked(senderId: number, nowMs: number = Date.now()): void {
  blocked.set(senderId, nowMs + BLOCKED_TTL_MS);
}

export function clearBlocked(senderId: number): void {
  blocked.delete(senderId);
}

/** Test helper. */
export function resetThrottle(): void {
  senders.clear();
  blocked.clear();
  global = { startMs: 0, count: 0 };
}
