import { handleVoicePost } from "@/lib/app/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Transcription plus one EGO turn: same budget as the chat route.
export const maxDuration = 120;

/** POST multipart { audio, requestId } -> text/event-stream; see lib/app/voice.ts. */
export async function POST(request: Request): Promise<Response> {
  // next/server cannot load under the offline test loader, so it is imported only here.
  const { after } = await import("next/server");
  return handleVoicePost(request, {
    async transcribe(audio) {
      const { transcribeTelegramVoiceNote } = await import("@/lib/voice-transcribe");
      return transcribeTelegramVoiceNote({ audio, mediaType: "audio/wav" });
    },
    async runTurn({ text, requestId }, emit) {
      const [{ appTurnDeps }, { runAppTurn }] = await Promise.all([
        import("@/lib/app/turn-deps"),
        import("@/lib/app/turn"),
      ]);
      await runAppTurn(appTurnDeps, { text, inputMode: "voice", requestId }, emit);
    },
    keepAlive: (run) => after(run),
  });
}
