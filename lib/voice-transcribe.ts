import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { downloadTelegramAudio } from "./telegram-files";
import { sendTelegramChatAction, sendTelegramMessage } from "./telegram";
import { listAllMemories } from "./memory";

const STATIC_VOCABULARY = [
  "EGO",
  "PayLah",
  "Apple Pay",
  "Grab",
  "SGD",
  "kg",
  "reps",
  "bench press",
  "incline Smith",
  "T-bar row",
  "lat pulldown",
  "personal calendar",
  "work calendar",
  "to-do list",
];

export function buildTranscriptionSystemPrompt(contactNames: string[]): string {
  const vocabulary = [...STATIC_VOCABULARY, ...contactNames].join(", ");
  return `You are an accurate audio transcription engine for EGO, a personal assistant.
Transcribe the user's spoken voice note verbatim into clear, natural text.
Do not add conversational replies, explanations, quotes, or markdown formatting.
If currency or numbers are mentioned, write them naturally (e.g. "$5 for coffee", "tomorrow from 3 pm to 4 pm").
Words and names you may hear (prefer these spellings when the audio matches): ${vocabulary}.
Output ONLY the transcribed text.`;
}

async function loadContactNames(): Promise<string[]> {
  try {
    const memories = await Promise.race([
      listAllMemories(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
    ]);
    return memories
      .filter((m) => m.category === "contact")
      .map((m) => m.key)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export async function transcribeTelegramVoiceNote(input: {
  audio: Uint8Array;
  mediaType: string;
  contactNames?: string[];
}): Promise<string> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing.");
  }

  // Normalize mediaType to standard audio MIME formats supported by Gemini
  let mediaType = (input.mediaType || "audio/ogg").split(";")[0].trim().toLowerCase();
  if (mediaType === "audio/oga" || mediaType === "audio/opus") {
    mediaType = "audio/ogg";
  }

  const result = await generateText({
    model: google("gemini-3.6-flash"),
    system: buildTranscriptionSystemPrompt(input.contactNames ?? []),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: input.audio,
            mediaType,
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

  let text = result.text.trim();
  // Strip outer quotes if the model wrapped the transcription in quotes
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith('“') && text.endsWith('”') && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

export async function handleVoiceNoteAction(params: {
  chatId: number;
  fileId: string;
  mimeType?: string;
}): Promise<string | null> {
  const { chatId, fileId, mimeType } = params;

  // Immediate visual feedback
  await sendTelegramChatAction(chatId, "record_voice");
  await sendTelegramMessage(chatId, "🎧 Listening to your voice note...");

  try {
    const [downloaded, contactNames] = await Promise.all([
      downloadTelegramAudio(fileId, mimeType),
      loadContactNames(),
    ]);
    const transcription = await transcribeTelegramVoiceNote({
      audio: downloaded.data,
      mediaType: downloaded.mediaType,
      contactNames,
    });

    if (!transcription) {
      await sendTelegramMessage(
        chatId,
        "I couldn't hear any words in that voice note. Please try again."
      );
      return null;
    }

    await sendTelegramMessage(chatId, `🎤 Heard: “${transcription}”`);
    return transcription;
  } catch (voiceError) {
    await sendTelegramMessage(
      chatId,
      "Sorry, I had trouble processing that voice note. Please try typing your message."
    );
    throw voiceError;
  }
}

