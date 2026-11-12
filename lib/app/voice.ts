import { requireOwner } from "./auth";
import { VOICE_MAX_BYTES, VOICE_MIN_SAMPLES_16K, parseWav, samplesAt16k } from "./audio";
import type { AppEvent } from "./events";
import { isValidRequestId, jsonError, readCappedBytes, sseResponse } from "./http";
import { VOICE_LIMIT_PER_MIN, rateLimited } from "./rate-limit";
import { ERROR_REPLY } from "./turn";

// The voice endpoint's logic, with the model call and the turn injected so the request
// validation and the too-short / empty-transcript paths test offline. The route supplies
// the production wiring. Audio arrives in the request, so nothing is fetched from
// Telegram, and nothing is sent to it: replies go out through the app channel.

/** Room for the multipart framing and the requestId field around the audio file. */
const MULTIPART_OVERHEAD_BYTES = 8 * 1024;

export const NOTHING_HEARD = "I couldn't hear anything. Hold the button while you speak and try again.";

export interface VoiceDeps {
  transcribe(audio: Uint8Array): Promise<string>;
  runTurn(input: { text: string; requestId: string }, emit: (e: AppEvent) => void): Promise<void>;
  /** Passed the run promise in the request scope (next/server after()). */
  keepAlive?: (run: Promise<void>) => void;
}

/** POST multipart { audio: WAV file, requestId } -> SSE: transcript first, then the turn. */
export async function handleVoicePost(request: Request, deps: VoiceDeps): Promise<Response> {
  const denied = requireOwner(request);
  if (denied) return denied;
  const limited = rateLimited(request, "voice", VOICE_LIMIT_PER_MIN);
  if (limited) return limited;

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return jsonError(415, "Unsupported Media Type");

  const maxBody = VOICE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBody) return jsonError(413, "Payload Too Large");
  // The streaming cap also covers a missing or lying content-length; nothing larger is buffered.
  const bytes = await readCappedBytes(request, maxBody);
  if (bytes === null) return jsonError(413, "Payload Too Large");

  let form: FormData;
  try {
    form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch {
    return jsonError(400, "Invalid form data");
  }

  const requestId = form.get("requestId");
  if (!isValidRequestId(requestId)) return jsonError(400, "Invalid requestId");
  const file = form.get("audio");
  if (typeof file === "string" || file === null) return jsonError(400, "audio is required");
  if (file.size > VOICE_MAX_BYTES) return jsonError(413, "Payload Too Large");

  const audio = new Uint8Array(await file.arrayBuffer());
  const wav = parseWav(audio);
  if (!wav) return jsonError(400, "audio must be 16-bit mono PCM WAV");
  const tooShort = samplesAt16k(wav) < VOICE_MIN_SAMPLES_16K;

  return sseResponse(
    async (emit) => {
      if (tooShort) {
        emit({ type: "error", message: NOTHING_HEARD });
        return;
      }
      emit({ type: "thinking" });
      let transcript: string;
      try {
        transcript = (await deps.transcribe(audio)).trim();
      } catch (err) {
        console.log(
          JSON.stringify({
            event: "app.voice.transcribe_failed",
            timestamp: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          })
        );
        emit({ type: "error", message: ERROR_REPLY });
        return;
      }
      if (!transcript) {
        emit({ type: "error", message: NOTHING_HEARD });
        return;
      }
      emit({ type: "transcript", text: transcript });
      await deps.runTurn({ text: transcript, requestId }, emit);
    },
    { keepAlive: deps.keepAlive }
  );
}
