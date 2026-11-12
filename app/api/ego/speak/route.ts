import { handleSpeakPost, synthesize } from "@/lib/app/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One TTS call for at most 400 characters.
export const maxDuration = 60;

/** POST { text } -> audio/wav; see lib/app/tts.ts. */
export async function POST(request: Request): Promise<Response> {
  return handleSpeakPost(request, { synthesize });
}
