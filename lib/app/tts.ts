import { requireOwner } from "./auth";
import { encodeWav } from "./audio";
import { jsonError, readJsonObject } from "./http";
import { SPEAK_LIMIT_PER_MIN, rateLimited } from "./rate-limit";
import { cleanSpeechText } from "./speech-text";

// Gemini text-to-speech. The AI SDK has no speech support for the Google provider, so this
// calls the REST API directly with the same key lib/voice-transcribe.ts uses.

export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_VOICE = "Kore";
const DEFAULT_RATE = 24_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface TtsResponse {
  candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
}

/** Synthesizes already-cleaned text. Gemini returns raw 16-bit PCM, which is wrapped as WAV. */
export async function synthesize(text: string, fetchImpl: FetchLike = fetch): Promise<{ wav: Uint8Array }> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing.");
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini TTS failed with status ${res.status}`);
  // The streaming endpoint is used even though the whole reply is read here: measured, it
  // finishes a short chunk in about 2.3 s against 3.7 s for generateContent.
  const parts: Buffer[] = [];
  let mimeType: string | undefined;
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event: TtsResponse;
    try {
      event = JSON.parse(line.slice(5)) as TtsResponse;
    } catch {
      continue;
    }
    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
      if (!part.inlineData?.data) continue;
      mimeType ??= part.inlineData.mimeType;
      parts.push(Buffer.from(part.inlineData.data, "base64"));
    }
  }
  if (parts.length === 0) throw new Error("Gemini TTS returned no audio.");
  const pcm = Buffer.concat(parts);
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const rate = Number(/rate=(\d+)/.exec(mimeType ?? "")?.[1]) || DEFAULT_RATE;
  return { wav: encodeWav(samples, rate) };
}

/** The client sends chunks of at most 400 characters; anything far past that is not a reply chunk. */
export const SPEAK_MAX_INPUT_CHARS = 1000;

export interface SpeakDeps {
  synthesize(text: string): Promise<{ wav: Uint8Array }>;
}

/** POST { text } -> audio/wav of the cleaned text. */
export async function handleSpeakPost(request: Request, deps: SpeakDeps): Promise<Response> {
  const denied = requireOwner(request);
  if (denied) return denied;
  const limited = rateLimited(request, "speak", SPEAK_LIMIT_PER_MIN);
  if (limited) return limited;
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const text = body.value.text;
  if (typeof text !== "string") return jsonError(400, "text is required");
  if (text.length > SPEAK_MAX_INPUT_CHARS) return jsonError(413, "Message too long");
  const cleaned = cleanSpeechText(text);
  if (!cleaned) return jsonError(400, "Nothing to say");
  try {
    const { wav } = await deps.synthesize(cleaned);
    return new Response(wav as BodyInit, {
      headers: { "content-type": "audio/wav", "cache-control": "no-store" },
    });
  } catch (err) {
    console.log(
      JSON.stringify({
        event: "app.speak.failed",
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return jsonError(502, "Speech is unavailable right now");
  }
}
