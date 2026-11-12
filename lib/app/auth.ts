import crypto from "node:crypto";
import { safeCompare } from "../security";

export const SESSION_COOKIE = "ego_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_INPUT_CHARS = 4000;

const MIN_TOKEN_LENGTH = 32;

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Token format: "<expiresAtMs>.<base64url HMAC-SHA256 of expiresAtMs>". */
export function signSession(secret: string, now: number): string {
  const expires = String(now + SESSION_TTL_MS);
  return `${expires}.${hmac(secret, expires)}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  now: number
): boolean {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expires = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(expires)) return false;
  if (!safeCompare(sig, hmac(secret, expires))) return false;
  return Number(expires) > now;
}

/** True when the app is configured well enough to authenticate anyone (fail closed otherwise). */
export function authConfigured(): boolean {
  return (
    !!process.env.EGO_APP_SECRET &&
    (process.env.EGO_APP_TOKEN?.length ?? 0) >= MIN_TOKEN_LENGTH
  );
}

/** POST needs an Origin header whose host equals the request host. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** null = allowed; otherwise a 401 or 403 Response. */
export function requireOwner(request: Request): Response | null {
  const secret = process.env.EGO_APP_SECRET;
  if (!secret || !authConfigured()) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!verifySession(readCookie(request, SESSION_COOKIE), secret, Date.now())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
