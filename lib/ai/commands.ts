import { sendTelegramMessage } from "../telegram";
import { aiLedger } from "./router";

export type CreditsCommand =
  | { kind: "show" }
  | { kind: "set"; provider: "gemini" | "perplexity"; amountUsd: number }
  | { kind: "usage_error"; message: string };

export const CREDITS_USAGE =
  "Usage: /credits to see balances, or /credits set gemini 25.00 (and /credits set perplexity 10.00) with the current dashboard balance in USD.";

export function parseCreditsCommand(text: string): CreditsCommand | null {
  const trimmed = text.trim();
  if (!/^\/credits(@\w+)?(\s|$)/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/).slice(1);
  if (parts.length === 0) return { kind: "show" };
  if (parts[0].toLowerCase() === "set") {
    const provider = parts[1]?.toLowerCase();
    const raw = parts[2]?.replace(/^\$/, "");
    const amount = raw === undefined || raw === "" ? NaN : Number(raw);
    if ((provider === "gemini" || provider === "perplexity") && Number.isFinite(amount) && amount >= 0) {
      return { kind: "set", provider, amountUsd: amount };
    }
  }
  return { kind: "usage_error", message: CREDITS_USAGE };
}

export async function handleCreditsCommand(params: { chatId: number; text: string }): Promise<void> {
  const command = parseCreditsCommand(params.text);
  if (!command) return;
  if (command.kind === "usage_error") {
    await sendTelegramMessage(params.chatId, command.message, undefined, null);
    return;
  }
  if (command.kind === "set") {
    await aiLedger.setBalance(command.provider, command.amountUsd);
  }
  const summary = await aiLedger.describe();
  const prefix =
    command.kind === "set"
      ? `✅ ${command.provider === "gemini" ? "Gemini" : "Perplexity"} balance set to $${command.amountUsd.toFixed(2)}.\n\n`
      : "";
  await sendTelegramMessage(params.chatId, prefix + summary, undefined, null);
}
