import {
  setEffectiveMonthlyBudget,
  setCategoryCap,
  formatBudgetSummary,
} from "@/lib/budget";
import { sendTelegramMessage } from "@/lib/telegram";

export async function handleBudgetSetAction(params: {
  chatId: number;
  intent: { amount: number; category?: string };
}): Promise<void> {
  const { chatId, intent } = params;
  const category = intent.category?.trim();

  try {
    if (category) {
      await setCategoryCap(category, intent.amount);
    } else {
      await setEffectiveMonthlyBudget(intent.amount);
    }
  } catch (err) {
    console.error("Failed to update budget config:", err);
    await sendTelegramMessage(
      chatId,
      "⚠️ Could not update the budget in Google Sheets. Please try again."
    );
    return;
  }

  const confirmation = category
    ? `✅ *${category}* cap set to $${intent.amount.toFixed(2)} per month.`
    : `✅ Monthly budget set to $${intent.amount.toFixed(2)}.`;

  const summary = await formatBudgetSummary().catch(() => "");
  await sendTelegramMessage(
    chatId,
    [confirmation, summary].filter(Boolean).join("\n\n"),
    {
      inline_keyboard: [[{ text: "« Back to Dashboard", callback_data: "menu:home" }]],
    }
  );
}

/**
 * Parses `/budget set <amount>` and `/budget cap <category> <amount>`.
 * Returns false when the text is not a budget-setting command, so the caller
 * can fall back to showing the budget summary.
 */
export async function tryHandleBudgetSetCommand(params: {
  chatId: number;
  text: string;
}): Promise<boolean> {
  const match = params.text
    .trim()
    .match(/^\/budget\s+(set|cap)\s+(.+)$/i);
  if (!match) return false;

  const mode = match[1].toLowerCase();
  const parts = match[2].trim().split(/\s+/);
  const amount = Number(parts[parts.length - 1]?.replace(/^\$/, ""));

  if (!Number.isFinite(amount) || amount <= 0) {
    await sendTelegramMessage(
      params.chatId,
      "ℹ️ *Usage*\n• `/budget set 600` — overall monthly budget\n• `/budget cap dining 150` — category cap"
    );
    return true;
  }

  const category = mode === "cap" ? parts.slice(0, -1).join(" ") : undefined;
  if (mode === "cap" && !category) {
    await sendTelegramMessage(
      params.chatId,
      "ℹ️ *Usage*: `/budget cap <category> <amount>` e.g. `/budget cap dining 150`"
    );
    return true;
  }

  await handleBudgetSetAction({
    chatId: params.chatId,
    intent: { amount, category },
  });
  return true;
}
