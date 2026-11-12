import { handleSpeakPost, synthesize } from "@/lib/app/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One TTS call per request. Input over 1000 characters is rejected (413) before any paid call;
// the text is cut to 400 characters only after cleaning. Rate limited per session in handleSpeakPost.
export const maxDuration = 60;

/** POST { text } -> audio/wav; see lib/app/tts.ts. */
export async function POST(request: Request): Promise<Response> {
  return handleSpeakPost(request, { synthesize });
}
