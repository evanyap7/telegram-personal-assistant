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

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const secret = process.env.EGO_APP_SECRET;
  if (!secret || !authConfigured()) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let token: unknown;
  try {
    token = ((await request.json()) as { token?: unknown } | null)?.token;
  } catch {
    token = undefined;
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
