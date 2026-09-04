import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export async function transcribeTelegramVoiceNote(input: {
  audio: Uint8Array;
  mediaType: string;
}): Promise<string> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing.");
  }

  const result = await generateText({
    model: google("gemini-3.6-flash"),
    system: `You are an accurate audio transcription engine for a personal assistant.
Transcribe the user's spoken voice note verbatim into clear, natural text.
Do not add conversational replies, explanations, quotes, or markdown formatting.
If currency or numbers are mentioned, write them naturally (e.g. "$5 for coffee", "tomorrow from 3 pm to 4 pm").
Output ONLY the transcribed text.`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: input.audio,
            mediaType: input.mediaType || "audio/ogg",
          },
          {
            type: "text",
            text: "Transcribe this audio recording into text accurately.",
          },
        ],
      },
    ],
    temperature: 0,
    maxOutputTokens: 500,
  });

  return result.text.trim();
}
