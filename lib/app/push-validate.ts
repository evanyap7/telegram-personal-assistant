// Validation for push subscriptions coming from the browser. Pure, so it is testable offline.

const MAX_ENDPOINT = 2048;
const MAX_KEY = 256;

const EXACT_HOSTS = new Set(["fcm.googleapis.com", "web.push.apple.com"]);
const HOST_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

function allowedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (EXACT_HOSTS.has(h)) return true;
  return HOST_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length);
}

/** An https URL on a known push-service host (no IP literals, localhost or credentials). */
export function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENDPOINT) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && allowedHost(u.hostname);
  } catch {
    return false;
  }
}

/** A base64url key whose decoded length is exactly `bytes`. */
export function validKey(value: unknown, bytes: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_KEY) return false;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  return Buffer.from(value.replace(/=+$/, ""), "base64url").length === bytes;
}

export const P256DH_BYTES = 65;
export const AUTH_BYTES = 16;
