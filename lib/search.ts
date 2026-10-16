import type { Provider } from "./ai/mode";
import { runText, withModelFallback } from "./ai/router";

export interface SearchAnswerResult {
  answer: string;
  source: "sonar" | "gemini" | "claude" | "fallback";
}

export const NO_WEB_FOOTER = "(No live web data right now, so this comes from my own knowledge.)";

export function searchSystemPrompt(provider: Provider): string {
  if (provider === "perplexity") {
    return `You are EGO, an intelligent, concise personal assistant for a user in Singapore.
Answer the user's question directly, accurately, and concisely.
Keep responses under 3-4 sentences whenever possible, with practical, factual information.
Include relevant times, opening hours, or numbers if requested.
Do not add conversational fluff or unprompted disclaimers.`;
  }
  if (provider === "gemini") {
    return `You are EGO, a helpful, concise personal assistant.
Answer the user's question directly and concisely in 2-3 sentences.
If it looks like a calendar event, expense, or to-do that wasn't recognized, suggest how to phrase it.`;
  }
  return `You are EGO, a helpful, concise personal assistant for a user in Singapore.
Answer the user's question directly and concisely in 2-3 sentences from your own knowledge.
You cannot browse the web, so if the question needs live information (current prices, opening hours, news) that you cannot confirm, say so plainly.
If it looks like a calendar event, expense, or to-do that wasn't recognized, suggest how to phrase it.`;
}

export async function answerWithSearch(query: string): Promise<SearchAnswerResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      answer: "How can I help you? You can ask me questions, or track finances, calendar events, and to-dos.",
      source: "fallback",
    };
  }

  try {
    const { result, handle } = await withModelFallback("search", async (h) => {
      const generated = await runText(h, {
        system: searchSystemPrompt(h.provider),
        prompt: trimmed,
        maxOutputTokens: h.provider === "perplexity" ? 500 : 400,
        temperature: h.provider === "perplexity" ? 0.2 : 0.3,
      });
      if (!generated.text?.trim()) throw new Error("Search model returned an empty answer.");
      return generated;
    });
    const text = result.text.trim();
    if (handle.provider === "anthropic") {
      return { answer: `${text}\n\n${NO_WEB_FOOTER}`, source: "claude" };
    }
    return { answer: text, source: handle.provider === "perplexity" ? "sonar" : "gemini" };
  } catch (error) {
    console.warn("All search models failed:", error);
  }

  return {
    answer: "I wasn't sure how to handle that. Try /help to see examples of calendar, finance, and to-do commands.",
    source: "fallback",
  };
}
