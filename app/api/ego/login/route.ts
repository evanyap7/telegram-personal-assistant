import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authConfigured,
  isSameOrigin,
  signSession,
} from "@/lib/app/auth";
import { safeCompare } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 1024;

/** Reads at most MAX_BODY_CHARS bytes; returns null if the body is larger. */
async function readCappedText(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_CHARS) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const secret = process.env.EGO_APP_SECRET;
  if (!secret || !authConfigured()) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return Response.json({ error: "Unsupported Media Type" }, { status: 415 });
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
    return Response.json({ error: "Payload Too Large" }, { status: 413 });
  }
  const text = await readCappedText(request);
  if (text === null) {
    return Response.json({ error: "Payload Too Large" }, { status: 413 });
  }

  let token: unknown;
  try {
    token = (JSON.parse(text) as { token?: unknown } | null)?.token;
  } catch {
    token = undefined;
  }
  if (typeof token === "string" && token.length > MAX_BODY_CHARS) {
    return Response.json({ error: "Payload Too Large" }, { status: 413 });
  }
  if (typeof token !== "string" || !safeCompare(token, process.env.EGO_APP_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const attrs = [
    `${SESSION_COOKIE}=${signSession(secret, Date.now())}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": attrs.join("; ") },
  });
}
