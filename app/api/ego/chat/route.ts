import { MAX_INPUT_CHARS, requireOwner } from "@/lib/app/auth";
import { isValidRequestId, jsonError, readJsonObject, sseResponse } from "@/lib/app/http";
import { runAppTurn } from "@/lib/app/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same budget as the Telegram webhook: one EGO turn, worst case about 60-90 s.
export const maxDuration = 120;

/** POST { text, requestId } -> text/event-stream of AppEvent frames for one EGO turn. */
export async function POST(request: Request): Promise<Response> {
  const denied = requireOwner(request);
  if (denied) return denied;

  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { text, requestId } = body.value;

  if (typeof text !== "string") return jsonError(400, "text is required");
  if (text.length > MAX_INPUT_CHARS) return jsonError(413, "Message too long");
  const trimmed = text.trim();
  if (!trimmed) return jsonError(400, "text is required");
  if (!isValidRequestId(requestId)) return jsonError(400, "Invalid requestId");

  // next/server cannot load under the offline test loader, so it is imported only here.
  // after() needs the request scope, which survives this await.
  const { after } = await import("next/server");

  return sseResponse(
    async (emit) => {
      // Immediate feedback before the cold-start import of the pipeline. An import failure
      // throws here and becomes a generic SSE error frame, not a framework 500.
      emit({ type: "thinking" });
      // Loaded only for a valid request: the production wiring pulls in the whole EGO
      // pipeline, which the offline validation tests must not load.
      const { appTurnDeps } = await import("@/lib/app/turn-deps");
      await runAppTurn(appTurnDeps, { text: trimmed, inputMode: "text", requestId }, emit);
    },
    // Keeps the function alive until the turn finishes, even if the client disconnects.
    { keepAlive: (run) => after(run) }
  );
}
