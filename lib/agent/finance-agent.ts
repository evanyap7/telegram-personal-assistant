import { google } from "@ai-sdk/google";
import { ToolLoopAgent, tool, isStepCount } from "ai";
import { z } from "zod";
import {
  addTransaction,
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

function buildInstructions(input: {
  today: string;
  targetTransaction: FinanceTransaction | null;
  repliedToText?: string;
}): string {
  const focus = input.targetTransaction
    ? `The transaction the user most likely means by "this", "that" or "the last one" (they swipe-replied to it, or it is the most recent):\n${JSON.stringify(
        compactTransaction(input.targetTransaction)
      )}`
    : "There is no obvious 'current' transaction.";

  return `You are the finance agent inside a personal Telegram assistant. The user tracks money in a Google Sheet. You fix mistakes and answer questions by calling tools.

Today is ${input.today} (Singapore time). Default currency is SGD.

${focus}
${input.repliedToText ? `The user is replying to this message: "${input.repliedToText}"` : ""}

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
        const added = await addTransaction({ ...input, explicitDate: date });
        lastUndoToken = await registerUndoAction(userId, {
          type: "finance_transaction_created",
          description: `${input.description} ($${input.amount.toFixed(2)})`,
          data: { transactionId: added.transactionId },
        });
        mutated = true;
        return { ok: true, transactionId: added.transactionId, date: added.timestamp };
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

  const agent = new ToolLoopAgent({
    model: google("gemini-3.6-flash"),
    instructions: buildInstructions({
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
      targetTransaction: params.targetTransaction,
      repliedToText: params.repliedToText,
    }),
    tools,
    stopWhen: isStepCount(8),
    temperature: 0,
  });

  // The incoming message is logged to chat history before this runs, so it
  // may already be the last turn; drop it to avoid sending it twice.
  const history = [...params.history];
  const last = history[history.length - 1];
  if (last?.role === "user" && last.text === params.text) history.pop();

  const messages = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: params.text },
  ];

  const result = await agent.generate({ messages });
  const reply = result.text.trim();

  if (!reply || (reply === NOT_FINANCE && !mutated)) {
    return { handled: false };
  }

  await sendTelegramMessage(
    chatId,
    reply,
    mutated && lastUndoToken ? buildUndoInlineKeyboard(lastUndoToken) : undefined,
    null
  );
  return {
    handled: true,
    completionStatus: mutated ? "finance_agent_mutated" : "finance_agent_replied",
  };
}
