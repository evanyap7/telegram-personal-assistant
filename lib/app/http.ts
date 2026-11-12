import { encodeSse, type AppEvent } from "./events";
import { ERROR_REPLY } from "./turn";

// Request and response helpers shared by the app's streaming endpoints. Free of the EGO
// pipeline so the routes' validation can be tested offline.

/**
 * Body cap for app JSON requests: MAX_INPUT_CHARS (4000) of 4-byte UTF-8 is 16 KB, and
 * JSON escaping of control characters can add more, so 32 KB leaves headroom.
 */
export const MAX_BODY_BYTES = 32 * 1024;

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** A client request id: 8-128 URL-safe characters (a UUID fits). */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

/** Reads at most `maxBytes` bytes; returns null if the body is larger. */
async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Reads a JSON object body: 415 unless the content type is application/json, 413 over
 * `maxBytes`, 400 unless the body parses to a plain object.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return { ok: false, response: jsonError(415, "Unsupported Media Type") };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: jsonError(413, "Payload Too Large") };
  }
  const text = await readCappedText(request, maxBytes);
  if (text === null) {
    return { ok: false, response: jsonError(413, "Payload Too Large") };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError(400, "Invalid JSON") };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, response: jsonError(400, "Expected a JSON object") };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function log(event: string, values: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...values }));
}

/**
 * Streams the events `run` emits as server-sent events. The run starts at once and each
 * event is enqueued as soon as it is emitted, so frames reach the client while the turn
 * is still working. The stream closes when the run settles. A run that throws ends with a
 * generic `error` frame. After the client disconnects, emits are silent no-ops and the
 * run carries on, so a turn's side effects finish like a Telegram turn's.
 */
export function sseResponse(run: (emit: (e: AppEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (e: AppEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(e)));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed or errored by the runtime.
        }
      };
      // Not awaited: start() returning early lets the response begin before the turn ends.
      void Promise.resolve()
        .then(() => run(emit))
        .catch((err) => {
          log("app.sse.run_failed", { error: err instanceof Error ? err.message : String(err) });
          emit({ type: "error", message: ERROR_REPLY });
        })
        .finally(finish);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
