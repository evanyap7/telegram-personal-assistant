import { requireOwner, requireSession } from "@/lib/app/auth";
import { jsonError, readJsonObject } from "@/lib/app/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4 * 1024;
const MAX_ENDPOINT = 2048;
const MAX_KEY = 256;

function vapidPublicKey(): string | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  return VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT ? VAPID_PUBLIC_KEY : null;
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENDPOINT) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}

/** GET -> { publicKey } so the client can subscribe without a rebuild. 503 when push is not configured. */
export async function GET(request: Request): Promise<Response> {
  const denied = requireSession(request);
  if (denied) return denied;
  const publicKey = vapidPublicKey();
  if (!publicKey) return jsonError(503, "Push is not configured");
  return Response.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
}

/** POST { subscription: { endpoint, keys: { p256dh, auth } } } stores it; POST { action: "unsubscribe", endpoint } removes it. */
export async function POST(request: Request): Promise<Response> {
  const denied = requireOwner(request);
  if (denied) return denied;

  const body = await readJsonObject(request, MAX_BODY);
  if (!body.ok) return body.response;
  const { action, endpoint, subscription } = body.value;

  if (!vapidPublicKey()) return jsonError(503, "Push is not configured");

  if (action === "unsubscribe") {
    if (!validEndpoint(endpoint)) return jsonError(400, "Invalid endpoint");
    const { removeSubscription } = await import("@/lib/app/push-store");
    await removeSubscription(endpoint);
    return Response.json({ ok: true });
  }

  if (action !== undefined && action !== "subscribe") return jsonError(400, "Invalid action");
  const sub = subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (typeof sub !== "object" || sub === null || !validEndpoint(sub.endpoint)) {
    return jsonError(400, "Invalid subscription");
  }
  const keys = sub.keys;
  if (typeof keys !== "object" || keys === null || !validKey(keys.p256dh) || !validKey(keys.auth)) {
    return jsonError(400, "Invalid subscription keys");
  }
  const { saveSubscription } = await import("@/lib/app/push-store");
  await saveSubscription({ endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  return Response.json({ ok: true });
}
