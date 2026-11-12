import { requireOwner } from "@/lib/app/auth";
import { isValidRequestId, jsonError, readJsonObject, sseResponse } from "@/lib/app/http";
import { runAppTurn, type AppTurnDeps } from "@/lib/app/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same budget as the Telegram webhook, which routes callback queries too.
export const maxDuration = 120;

/** Telegram caps callback_data at 64 bytes, so no button the app renders carries more. */
const MAX_CALLBACK_DATA_BYTES = 64;

/**
 * POST { data, messageId, requestId } -> text/event-stream of AppEvent frames. Runs the
 * Telegram callback router for one button press inside the app channel, so its answers,
 * edits and messages come back as events.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = requireOwner(request);
  if (denied) return denied;

  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const { data, messageId, requestId } = body.value;

  if (
    typeof data !== "string" ||
    !data ||
    Buffer.byteLength(data, "utf-8") > MAX_CALLBACK_DATA_BYTES
  ) {
    return jsonError(400, "Invalid callback data");
  }
  if (typeof messageId !== "number" || !Number.isSafeInteger(messageId) || messageId <= 0) {
    return jsonError(400, "Invalid messageId");
  }
  if (!isValidRequestId(requestId)) return jsonError(400, "Invalid requestId");

  // Loaded only for a valid request: these pull in the whole bot, which the offline
  // validation tests must not load.
  const [{ appTurnDeps }, { dispatchCallback }] = await Promise.all([
    import("@/lib/app/turn-deps"),
    import("@/lib/telegram/callback-router"),
  ]);

  const startedAt = Date.now();
  const deps: AppTurnDeps = {
    ...appTurnDeps,
    // A button press is not a chat message; the Telegram route does not log callbacks either.
    logUserMessage: async () => {},
    // The router marks the update completed itself, as it does for Telegram, so no
    // completion status is returned for the runner to write.
    async turn(t) {
      await dispatchCallback({
        callbackId: "app",
        callbackData: data,
        userId: t.userId,
        chatId: t.chatId,
        messageId,
        updateId: t.updateId,
        startedAt,
      });
      return {};
    },
  };

  return sseResponse((emit) =>
    runAppTurn(deps, { text: data, inputMode: "text", requestId }, emit)
  );
}
