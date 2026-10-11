import { perplexity } from "@ai-sdk/perplexity";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

export interface SearchAnswerResult {
  answer: string;
  source: "sonar" | "gemini" | "fallback";
}

export async function answerWithSearch(query: string): Promise<SearchAnswerResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      answer: "How can I help you? You can ask me questions, or track finances, calendar events, and to-dos.",
      source: "fallback",
    };
  }

  // 1. Try Perplexity Sonar if API key is present (best for web search & real-time facts)
  if (process.env.PERPLEXITY_API_KEY) {
    try {
      const result = await generateText({
        model: perplexity("sonar"),
        system: `You are an intelligent, concise personal assistant for a user in Singapore.
Answer the user's question directly, accurately, and concisely.
Keep responses under 3-4 sentences whenever possible, with practical, factual information.
Include relevant times, opening hours, or numbers if requested.
Do not add conversational fluff or unprompted disclaimers.`,
        prompt: trimmed,
        maxOutputTokens: 500,
        temperature: 0.2,
      });

      if (result.text?.trim()) {
        return {
          answer: result.text.trim(),
          source: "sonar",
        };
      }
    } catch (sonarErr) {
      console.warn("Perplexity Sonar search failed, falling back to Gemini:", sonarErr);
    }
  }

  // 2. Fallback to Gemini 3.6 Flash if Google key is present
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    try {
      const result = await generateText({
        model: google("gemini-3.6-flash"),
        system: `You are a helpful, concise personal assistant.
Answer the user's question directly and concisely in 2-3 sentences.
If it looks like a calendar event, expense, or to-do that wasn't recognized, suggest how to phrase it.`,
        prompt: trimmed,
        maxOutputTokens: 400,
        temperature: 0.3,
      });

      if (result.text?.trim()) {
        return {
          answer: result.text.trim(),
          source: "gemini",
        };
      }
    } catch (geminiErr) {
      console.warn("Gemini fallback answer failed:", geminiErr);
    }
  }

  return {
    answer: "I wasn't sure how to handle that. Try /help to see examples of calendar, finance, and to-do commands.",
    source: "fallback",
  };
}
