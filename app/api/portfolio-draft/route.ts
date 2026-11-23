import { createDefaultDraftDeps, handleDraftIntake } from "@/lib/handlers/portfolio-draft";

export const dynamic = "force-dynamic";

/**
 * Signed "draft ready" webhook from the portfolio updater's GitHub Action.
 * Auth is an HMAC-SHA256 of the raw body (x-signature: sha256=<hex>) with EGO_WEBHOOK_SECRET.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.EGO_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  }
  let deps;
  try {
    deps = createDefaultDraftDeps();
  } catch {
    return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  }
  return handleDraftIntake(req, { ...deps, secret });
}
