import {
  addTransaction,
  FinanceSummary,
  FinanceTransaction,
  getFinanceSummary,
  getLatestTransaction,
  getTransactionById,
  searchActiveTransactions,
  queryFilteredTransactions,
  formatFilteredFinanceSummary,
} from "@/lib/finance";
import { isBudgetActiveForSheet } from "@/lib/budget";
import {
  savePendingFinanceDeleteAction,
  savePendingFinanceSelection,
} from "@/lib/pending-actions";
import { sendTelegramMessage } from "@/lib/telegram";

export function formatFinanceTransaction(input: {
  type: string;
  amount: string;
  currency: string;
  category: string;
  description: string;
  transactionId?: string;
  timestamp?: string;
}): string {
  return [
    `${input.type || "unknown"}: ${input.amount || "?"} ${input.currency}`,
    `Category: ${input.category || "Uncategorized"}`,
    `Description: ${input.description || "No description"}`,
    input.timestamp ? `Recorded: ${input.timestamp}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatFinanceSummary(summary: FinanceSummary): string {
  const periodTitles: Record<string, string> = {
    today: "Today",
    week: "Past 7 Days",
    month: summary.targetMonth ? `This Month (${summary.targetMonth})` : "This Month",
    all: "All Time",
  };
  const title = periodTitles[summary.period] ?? summary.period;
  const netSign = summary.netSavings >= 0 ? "+" : "";

  const lines = [
    `📊 Finance Summary (${title})`,
    "",
    `💰 Total Income: $${summary.totalIncome.toFixed(2)} ${summary.currency}`,
    `💸 Total Expenses: $${summary.totalExpense.toFixed(2)} ${summary.currency}`,
    `📈 Net Balance: ${netSign}$${summary.netSavings.toFixed(2)} ${summary.currency}`,
    `📝 Active Transactions: ${summary.transactionCount}`,
  ];

  if (summary.period === "month") {
    const budget = Number(process.env.MONTHLY_BUDGET) || 500;
    const targetMonth = summary.targetMonth || "";
    if (isBudgetActiveForSheet(targetMonth)) {
      const remaining = budget - summary.totalExpense;
      const pct = budget > 0 ? (summary.totalExpense / budget) * 100 : 0;
      lines.push(`🎯 Monthly Budget: $${budget.toFixed(2)} ${summary.currency}`);
      if (remaining >= 0) {
        lines.push(`💰 Remaining: $${remaining.toFixed(2)} / $${budget.toFixed(2)} (${(100 - pct).toFixed(1)}% remaining)`);
      } else {
        lines.push(`🚨 Budget Exceeded: -$${Math.abs(remaining).toFixed(2)} / $${budget.toFixed(2)}`);
      }
    } else {
      lines.push(`🎯 Budget Notice: $${budget.toFixed(2)}/mo cap begins 1 Oct 2026`);
    }
  }

  if (summary.categories.length > 0) {
    lines.push("", "Spending Breakdown by Category:");
    for (const cat of summary.categories) {
      lines.push(
        `• ${cat.category}: $${cat.amount.toFixed(2)} (${cat.percentage.toFixed(1)}%)`
      );
    }
  } else {
    lines.push("", "No recorded expenses in this period.");
  }

  return lines.join("\n");
}

export async function resolveRepliedTransaction(
  repliedMessage?: {
    text?: string;
    reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> };
  } | null
): Promise<FinanceTransaction | null> {
  if (!repliedMessage) return null;

  const text = repliedMessage.text || "";

  // 1. Direct txn_ match in text (if present)
  const textTxnMatch = text.match(/txn_[a-zA-Z0-9_-]+/);
  if (textTxnMatch) {
    const txn = await getTransactionById(textTxnMatch[0]);
    if (txn) return txn;
  }

  // 2. Check inline keyboard callback data
  if (repliedMessage.reply_markup?.inline_keyboard) {
    for (const row of repliedMessage.reply_markup.inline_keyboard) {
      for (const btn of row) {
        const btnMatch = btn.callback_data?.match(/txn_[a-zA-Z0-9_-]+/);
        if (btnMatch) {
          const txn = await getTransactionById(btnMatch[0]);
          if (txn) return txn;
        }
      }
    }
  }

  // 3. Match from Description / Item / Merchant / Source and Amount in text
  const descMatch = text.match(/(?:Description|Merchant|Item|Source):\s*\*?([^\n*]+)/i);
  const amtMatch = text.match(/Amount:\s*\*?(?:SGD\s*)?([0-9]+(?:\.[0-9]{2})?)/i);

  if (descMatch) {
    const query = descMatch[1].trim().split("@")[0].trim();
    const matches = await searchActiveTransactions(query);
    if (matches.length > 0) {
      if (amtMatch) {
        const amt = parseFloat(amtMatch[1]);
        const exact = matches.find(
          (m) => Math.abs(parseFloat(m.amount) - amt) < 0.01
        );
        if (exact) return exact;
      }
      return matches[0];
    }
  }

  // 4. If message text indicates confirmation or update, fallback to latest
  if (
    text.includes("Transaction added") ||
    text.includes("Expense Synced") ||
    text.includes("Expense Logged") ||
    text.includes("Transaction updated") ||
    text.includes("Funds Received") ||
    text.includes("GIRO Deduction Logged") ||
    text.includes("Ride Logged")
  ) {
    return await getLatestTransaction();
  }

  return null;
}

export async function handleFinanceAddAction(params: {
  chatId: number;
  intent: {
    type: "income" | "expense";
    amount: number;
    currency: string;
    category: string;
    description: string;
    explicitDate?: string;
  };
  messageDateObj?: Date;
}): Promise<void> {
  const { chatId, intent, messageDateObj } = params;
  const transaction = await addTransaction({
    type: intent.type,
    amount: intent.amount,
    currency: intent.currency,
    category: intent.category,
    description: intent.description,
    explicitDate: intent.explicitDate,
    transactionTimestamp: messageDateObj,
  });

  const responseLines = [
    "Transaction added.",
    `Type: ${intent.type}`,
    `Amount: ${intent.amount.toFixed(2)} ${intent.currency}`,
    `Category: ${intent.category}`,
    `Description: ${intent.description}`,
    `Date & Time: ${transaction.timestamp} (SGT)`,
  ];

  if (transaction.budgetStatus?.hasBudget && intent.type === "expense") {
    responseLines.push("", transaction.budgetStatus.formattedNotice);

    // Threshold breach alerts
    if (transaction.budgetStatus.isOverBudget) {
      responseLines.push("🚨 Alert: You have exceeded 100% of your monthly budget!");
    } else if (transaction.budgetStatus.thresholdCrossed === 80) {
      responseLines.push(
        `⚠️ Alert: You have reached 80% of your monthly budget ($${transaction.budgetStatus.remaining.toFixed(2)} remaining).`
      );
    } else if (transaction.budgetStatus.thresholdCrossed === 50) {
      responseLines.push("ℹ️ Note: You have reached 50% of your monthly budget.");
    }

    // Category cap alerts
    if (
      transaction.budgetStatus.categoryCapAlerts &&
      transaction.budgetStatus.categoryCapAlerts.length > 0
    ) {
      responseLines.push("");
      for (const capAlert of transaction.budgetStatus.categoryCapAlerts) {
        responseLines.push(capAlert);
      }
    }
  }

  await sendTelegramMessage(chatId, responseLines.join("\n"));
}

export async function handleFinanceSummaryAction(params: {
  chatId: number;
  period: "today" | "week" | "month" | "all";
}): Promise<void> {
  const { chatId, period } = params;
  const summary = await getFinanceSummary(period);
  await sendTelegramMessage(chatId, formatFinanceSummary(summary));
}

function truncateButtonText(text: string, maxLength = 60): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export async function handleFinanceDeleteSearchAction(params: {
  chatId: number;
  userId: number;
  resolvedTxnId?: string;
  query: string;
}): Promise<"confirmed" | "found" | "empty"> {
  const { chatId, userId, resolvedTxnId, query } = params;

  if (resolvedTxnId) {
    const transaction = await getTransactionById(resolvedTxnId);
    if (transaction) {
      const confirmationToken = await savePendingFinanceDeleteAction({
        userId,
        payload: { transactionId: transaction.transactionId },
      });

      await sendTelegramMessage(
        chatId,
        [
          "Delete this finance transaction?",
          "",
          formatFinanceTransaction(transaction),
          "",
          "This will mark the row as deleted in Google Sheets.",
        ].join("\n"),
        {
          inline_keyboard: [
            [
              {
                text: "🗑️ Yes, delete",
                callback_data: `finance_delete_yes:${confirmationToken}`,
              },
              {
                text: "❌ No, keep it",
                callback_data: `finance_delete_no:${confirmationToken}`,
              },
            ],
          ],
        }
      );
      return "confirmed";
    }
  }

  const matches = await searchActiveTransactions(query);
  if (matches.length === 0) {
    await sendTelegramMessage(
      chatId,
      `No active finance transactions matched “${query}”.`
    );
    return "empty";
  }

  const limitedMatches = matches.slice(0, 5);
  const selectionToken = await savePendingFinanceSelection({
    userId,
    transactionIds: limitedMatches.map((t) => t.transactionId),
  });

  await sendTelegramMessage(
    chatId,
    [
      `Found ${limitedMatches.length} active finance match${
        limitedMatches.length === 1 ? "" : "es"
      } for “${query}”.`,
      "",
      "Choose the exact transaction to delete:",
    ].join("\n"),
    {
      inline_keyboard: limitedMatches.map((transaction, index) => [
        {
          text: truncateButtonText(
            `${transaction.type === "income" ? "📈" : "💸"} ${transaction.amount} ${transaction.currency} — ${transaction.description}`
          ),
          callback_data: `finance_select:${selectionToken}:${index}`,
        },
      ]),
    }
  );

  return "found";
}

export async function handleFinanceQueryAction(params: {
  chatId: number;
  intent: {
    merchant?: string;
    category?: string;
    month?: string;
    type?: "income" | "expense";
  };
}): Promise<void> {
  const { chatId, intent } = params;
  const summary = await queryFilteredTransactions(intent);
  await sendTelegramMessage(chatId, formatFilteredFinanceSummary(summary));
}
