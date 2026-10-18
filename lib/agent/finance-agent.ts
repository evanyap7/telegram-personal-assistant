import { recordModelUsage, withModelFallback } from "@/lib/ai/router";
import { ToolLoopAgent, tool, isStepCount } from "ai";
import { z } from "zod";
import {
  getFinanceSummary,
  getTransactionById,
  queryFilteredTransactions,
  softDeleteTransaction,
  updateTransaction,
  type FinanceTransaction,
} from "@/lib/finance";
import {
  getMonthlyBudgetStatus,
  setCategoryCap,
  setEffectiveMonthlyBudget,
} from "@/lib/budget";
import { buildUndoInlineKeyboard, registerUndoAction } from "@/lib/undo";
import { sendTelegramMessage } from "@/lib/telegram";
import { SECURITY_SYSTEM_GUARDRAIL } from "@/lib/security";
import type { FormattedChatTurn } from "@/lib/chat-history";
import { spokenInputNote, type InputMode } from "@/lib/agent/input-mode";
import { toConversationMessages } from "@/lib/agent/conversation-messages";
import { resolveAgentReply } from "@/lib/agent/agent-reply";
import { addTransactionWithConversion, buildBudgetAlertLines } from "@/lib/agent/finance-add";

const MAX_SEARCH_RESULTS = 15;
const NOT_FINANCE = "NOT_FINANCE";

function compactTransaction(t: FinanceTransaction) {
  return {
    transactionId: t.transactionId,
    date: t.timestamp,
    type: t.type,
    amount: Number(t.amount),
    currency: t.currency,
    category: t.category,
    description: t.description,
  };
}

export function buildFinanceInstructions(input: {
  today: string;
  targetTransaction: FinanceTransaction | null;
  repliedToText?: string;
  inputMode?: InputMode;
}): string {
  const focus = input.targetTransaction
    ? `The transaction the user most likely means by "this", "that" or "the last one" (they swipe-replied to it, or it is the most recent):\n${JSON.stringify(
        compactTransaction(input.targetTransaction)
      )}`
    : "There is no obvious 'current' transaction.";
  const spoken = spokenInputNote(input.inputMode);

  return `You are the finance agent inside EGO, a personal Telegram assistant. The user tracks money in a Google Sheet. You log, fix and answer questions by calling tools.

Today is ${input.today} (Singapore time). Default currency is SGD.

${focus}
${input.repliedToText ? `The user is replying to this message: "${input.repliedToText}"` : ""}
${spoken ? `\n${spoken}\n` : ""}
How to work:
- Never guess a transactionId. Take it from the focus transaction above or from searchTransactions.
- To edit or delete something, find it first. If several transactions plausibly match and the user's words don't settle it, ask which one instead of picking.
- If the user says "that" or "the last one", use the focus transaction.
- Make the change with the tool, then reply briefly with what changed (old -> new). Edits and deletes are undoable, so act without asking when the target is clear.
- For anything that touches many transactions at once (e.g. "delete all my food expenses"), list what you'd affect and ask for confirmation before deleting.
- If a description carries a source tag like "(DBS PayLah)" or "(Apple Pay)", or an " @ merchant" suffix, keep it when renaming.
- Only report what tools returned. If a tool fails, say so plainly.
- If the request has nothing to do with money, transactions or the budget, reply with exactly: ${NOT_FINANCE}
- Reply in plain text, short, no Markdown tables. Amounts as $12.50.

Logging rules:
- Treat "$" as SGD unless another currency is named. Use uppercase three-letter currency codes.
- Use a sensible category: Dining, Transport, Groceries, Shopping, Entertainment, Health, Education, Utilities, Salary, or Other.
- Only pass a date to addTransaction or updateTransaction when the user's current message names a specific date or relative day ("yesterday", "last Friday", "on 3 Sep"). Otherwise omit it.
- If the amount is missing, ask for it instead of guessing.
- NEVER invent dishes, items, drinks, products or merchants. If the input is generic ("spent $10", "paid $15"), the description is "Expense" (or "Income") and the category is "Other". Only use a specific description when the user said it ("spent $5 on iced latte" is "iced latte", Dining).
- If addTransaction returns a conversionNotice, a budgetNotice or any budgetAlerts, add each on its own line after your confirmation, word for word. The amount and currency it returns are what was actually recorded (foreign currencies are converted to SGD); report those, not the original.
- A user who replies to a transaction with what it was ("supper", "it was lunch", "make it $12", "it was $12 not $6", "change category to Dining") wants that transaction edited, not a new one logged.

Budget rules:
- "set my budget to $600" or "my budget is $450 a month": setBudget with that amount and no category.
- "increase my budget to $700 instead", "lower the budget to 400": setBudget with the NEW total, not the difference.
- "cap dining at $150", "limit shopping to $100 a month": setBudget with the amount and the category.
- Asking to view the budget is getBudgetStatus, not setBudget.

${SECURITY_SYSTEM_GUARDRAIL}`;
}

export type FinanceAgentResult =
  | { handled: false }
  | { handled: true; completionStatus: string };

export async function runFinanceAgent(params: {
  chatId: number;
  userId: number;
  text: string;
  targetTransaction: FinanceTransaction | null;
  repliedToText?: string;
  history: FormattedChatTurn[];
  inputMode?: InputMode;
  /** When the user sent the message; new transactions are stamped with it. */
  messageDate?: Date;
}): Promise<FinanceAgentResult> {
  const { chatId, userId } = params;
  let lastUndoToken: string | null = null;
  let mutated = false;

  const tools = {
    searchTransactions: tool({
      description:
        "Search active transactions. All filters are optional and combine. Returns up to 15 most recent matches, oldest first. With no filters returns the latest transactions.",
      inputSchema: z.object({
        query: z.string().optional().describe("Text to match in the description"),
        category: z.string().optional(),
        type: z.enum(["income", "expense"]).optional(),
        month: z
          .string()
          .optional()
          .describe('"this month", "last month", or a month name like "October"'),
        amount: z.number().optional().describe("Exact amount to match"),
      }),
      execute: async ({ query, category, type, month, amount }) => {
        const res = await queryFilteredTransactions({
          merchant: query,
          category,
          type,
          month,
        });
        const matches =
          amount === undefined
            ? res.transactions
            : res.transactions.filter(
                (t) => Math.abs(Number(t.amount) - amount) < 0.005
              );
        return {
          totalMatches: matches.length,
          transactions: matches.slice(-MAX_SEARCH_RESULTS).map(compactTransaction),
        };
      },
    }),

    updateTransaction: tool({
      description:
        "Edit fields of one existing transaction. Only include fields that change.",
      inputSchema: z.object({
        transactionId: z.string(),
        type: z.enum(["income", "expense"]).optional(),
        amount: z.number().positive().optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        category: z.string().min(1).max(50).optional(),
        description: z.string().min(1).max(200).optional(),
        date: z.string().date().optional().describe("YYYY-MM-DD"),
      }),
      execute: async ({ transactionId, date, ...fields }) => {
        const before = await getTransactionById(transactionId);
        if (!before) return { ok: false, error: "Transaction not found." };

        const updates = { ...fields, ...(date ? { explicitDate: date } : {}) };
        const after = await updateTransaction(transactionId, updates);
        if (!after) return { ok: false, error: "Update failed." };

        const previous = {
          type: before.type as "income" | "expense",
          amount: Number(before.amount),
          currency: before.currency,
          category: before.category,
          description: before.description,
          ...(date ? { explicitDate: before.timestamp.slice(0, 10) } : {}),
        };
        lastUndoToken = await registerUndoAction(userId, {
          type: "finance_transaction_updated",
          description: before.description,
          data: { transactionId, previous: JSON.stringify(previous) },
        });
        mutated = true;
        return {
          ok: true,
          before: compactTransaction(before),
          after: compactTransaction(after),
        };
      },
    }),

    deleteTransaction: tool({
      description: "Delete one transaction (soft delete; the user can undo).",
      inputSchema: z.object({ transactionId: z.string() }),
      execute: async ({ transactionId }) => {
        const deleted = await softDeleteTransaction(transactionId);
        if (!deleted) return { ok: false, error: "Transaction not found." };
        lastUndoToken = await registerUndoAction(userId, {
          type: "finance_transaction_deleted",
          description: `${deleted.description} ($${Number(deleted.amount).toFixed(2)})`,
          data: { transactionId },
        });
        mutated = true;
        return { ok: true, deleted: compactTransaction(deleted) };
      },
    }),

    addTransaction: tool({
      description: "Record a new transaction.",
      inputSchema: z.object({
        type: z.enum(["income", "expense"]),
        amount: z.number().positive(),
        currency: z.string().regex(/^[A-Z]{3}$/).default("SGD"),
        category: z.string().min(1).max(50),
        description: z.string().min(1).max(200),
        date: z.string().date().optional().describe("YYYY-MM-DD, defaults to today"),
      }),
      execute: async ({ date, ...input }) => {
        const result = await addTransactionWithConversion({
          ...input,
          explicitDate: date,
          transactionTimestamp: params.messageDate,
        });
        const { added } = result;
        lastUndoToken = await registerUndoAction(userId, {
          type: "finance_transaction_created",
          description: `${result.effectiveDescription} ($${result.effectiveAmount.toFixed(2)} ${result.effectiveCurrency})`,
          data: { transactionId: added.transactionId },
        });
        mutated = true;
        const trackBudget = added.budgetStatus?.hasBudget && input.type === "expense";
        return {
          ok: true,
          transactionId: added.transactionId,
          date: added.timestamp,
          amount: result.effectiveAmount,
          currency: result.effectiveCurrency,
          description: result.effectiveDescription,
          conversionNotice: result.conversionNotice || null,
          budgetNotice: trackBudget ? added.budgetStatus?.formattedNotice ?? null : null,
          budgetAlerts: buildBudgetAlertLines(added.budgetStatus, input.type),
        };
      },
    }),

    getSummary: tool({
      description: "Total income, expenses and per-category spending for a period.",
      inputSchema: z.object({
        period: z.enum(["today", "week", "month", "all"]).default("month"),
      }),
      execute: async ({ period }) => getFinanceSummary(period),
    }),

    getBudgetStatus: tool({
      description:
        "Current month's budget, spend so far, remaining amount and category caps.",
      inputSchema: z.object({}),
      execute: async () => {
        const s = await getMonthlyBudgetStatus();
        return {
          hasBudget: s.hasBudget,
          month: s.monthName,
          budget: s.budget,
          spent: s.totalExpenses,
          remaining: s.remaining,
          currency: s.currency,
          categoryCaps: s.categoryCaps,
        };
      },
    }),

    setBudget: tool({
      description:
        "Set the overall monthly budget, or a per-category monthly cap when category is given.",
      inputSchema: z.object({
        amount: z.number().positive(),
        category: z.string().optional(),
      }),
      execute: async ({ amount, category }) => {
        if (category) await setCategoryCap(category, amount);
        else await setEffectiveMonthlyBudget(amount);
        return { ok: true, amount, category: category ?? "overall" };
      },
    }),
  };

  const instructions = buildFinanceInstructions({
    today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
    targetTransaction: params.targetTransaction,
    repliedToText: params.repliedToText,
    inputMode: params.inputMode,
  });

  const messages = toConversationMessages(params.history, params.text);

  const { result } = await withModelFallback(
    "agent",
    async (handle) => {
      const agent = new ToolLoopAgent({
        model: handle.model,
        instructions,
        tools,
        stopWhen: isStepCount(8),
        providerOptions: handle.providerOptions,
        ...handle.sampling(0),
      });
      const generated = await agent.generate({ messages });
      await recordModelUsage(handle, generated.totalUsage);
      return generated;
    },
    { canRetry: () => !mutated }
  );
  const decision = resolveAgentReply({ reply: result.text, mutated, sentinel: NOT_FINANCE });
  if (decision.kind === "decline") {
    return { handled: false };
  }

  await sendTelegramMessage(
    chatId,
    decision.text,
    mutated && lastUndoToken ? buildUndoInlineKeyboard(lastUndoToken) : undefined,
    null
  );
  return {
    handled: true,
    completionStatus: mutated ? "finance_agent_mutated" : "finance_agent_replied",
  };
}
