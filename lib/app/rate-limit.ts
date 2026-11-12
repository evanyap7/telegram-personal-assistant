import { SESSION_COOKIE, readCookie } from "./auth";
import { jsonError } from "./http";

// Best-effort, in-memory, per-instance rate limit for the paid speech and transcription endpoints (speak, voice).
// On serverless each warm instance keeps its own counters and a cold start resets them, so this
// bounds a runaway client or a stolen cookie per instance; it is not a global quota.

export const RATE_WINDOW_MS = 60_000;
export const SPEAK_LIMIT_PER_MIN = 40; // a spoken reply is a few chunks, fetched together
export const VOICE_LIMIT_PER_MIN = 12;
const MAX_KEYS = 200;

const hits = new Map<string, number[]>();

/** Test hook: forget all counters. */
export function resetRateLimits(): void {
  hits.clear();
}

/** True when the call is allowed (and counted). */
export function takeToken(bucket: string, key: string, limit: number, now = Date.now()): boolean {
  const id = `${bucket}:${key}`;
  const recent = (hits.get(id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(id, recent);
    return false;
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > MAX_KEYS) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return true;
}

/** null = allowed; otherwise a 429. Call after auth so only the owner's session is counted. */
export function rateLimited(request: Request, bucket: "speak" | "voice", limit: number): Response | null {
  const key = readCookie(request, SESSION_COOKIE) ?? "anon";
  if (takeToken(bucket, key, limit)) return null;
  const res = jsonError(429, "Too many requests, slow down");
  res.headers.set("retry-after", "30");
  return res;
}
