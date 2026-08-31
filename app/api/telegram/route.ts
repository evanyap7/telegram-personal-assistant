import { z } from "zod";

import { parseAssistantIntent } from "@/lib/assistant-intent";
import { createCalendarEvent } from "@/lib/calendar";
import {
  addTransaction,
  listRecentTransactions,
} from "@/lib/finance";
import {
  cancelPendingActionsForUser,
  savePendingAction,
  takePendingAction,
} from "@/lib/pending-actions";
import { sendTelegramMessage } from "@/lib/telegram";

const telegramUpdateSchema = z.object({
  message: z
    .object({
      chat: z.object({
        id: z.number(),
      }),
      from: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
    })
    .optional(),
});

const financeAddSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().positive(),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  category: z.string().min(1).max(50),
  description: z.string().min(1).max(200),
});

function helpText() {
  return [
    "Hi — I’m your personal assistant.",
    "",
    "You can write naturally:",
    "• spent $6.20 for lunch",
    "• earned $100 from freelance work",
    "• schedule floorball tomorrow from 8 pm to 9:30 pm",
    "",
    "Finance entries are saved after I understand them.",
    "Calendar changes require confirmation.",
    "",
    "Tap Menu to view commands.",
  ].join("\n");
}

function formatSingaporeDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export async function POST(request: Request) {
  const secretHeader = request.headers.get(
    "x-telegram-bot-api-secret-token"
  );

  if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = telegramUpdateSchema.parse(await request.json());
    const message = update.message;

    if (!message?.text) {
      return Response.json({ ok: true });
    }

    const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);

    if (!allowedUserId || message.from.id !== allowedUserId) {
      return new Response("Forbidden", { status: 403 });
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text.trim();

    if (text === "/start" || text === "/help") {
      await sendTelegramMessage(chatId, helpText());

      return Response.json({ ok: true });
    }

    if (text === "/cancel") {
      const cancelled = cancelPendingActionsForUser(userId);

      await sendTelegramMessage(
        chatId,
        cancelled > 0
          ? "Pending calendar action cancelled."
          : "There was no pending calendar action to cancel."
      );

      return Response.json({ ok: true });
    }

    if (text.startsWith("/confirm ")) {
      const token = text.replace("/confirm ", "").trim();
      const pendingAction = takePendingAction(token, userId);

      if (!pendingAction) {
        await sendTelegramMessage(
          chatId,
          "That confirmation token is invalid or has expired. Please send the request again."
        );

        return Response.json({ ok: true });
      }

      if (pendingAction.type === "calendar_add") {
        const event = await createCalendarEvent(pendingAction.payload);

        await sendTelegramMessage(
          chatId,
          [
            "Calendar event created.",
            `Calendar: ${pendingAction.payload.calendarName}`,
            `Title: ${pendingAction.payload.title}`,
            `Start: ${formatSingaporeDateTime(pendingAction.payload.start)}`,
            `End: ${formatSingaporeDateTime(pendingAction.payload.end)}`,
            `Event ID: ${event.id}`,
            event.htmlLink ? `Link: ${event.htmlLink}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );

        return Response.json({ ok: true });
      }

      await sendTelegramMessage(
        chatId,
        "This confirmation type is not supported."
      );

      return Response.json({ ok: true });
    }

    if (text === "/finance") {
      await sendTelegramMessage(
        chatId,
        [
          "Finance assistant:",
          "",
          "Write naturally:",
          "• spent $6.20 for lunch",
          "• earned $100 from freelance work",
          "",
          "Or use:",
          "/finance list",
        ].join("\n")
      );

      return Response.json({ ok: true });
    }

    if (text === "/calendar") {
      await sendTelegramMessage(
        chatId,
        [
          "Calendar assistant:",
          "",
          "Write naturally:",
          "• Schedule floorball tomorrow from 8 pm to 9:30 pm",
          "• Add a project meeting next Friday from 2 pm to 3 pm in work",
          "",
          "I will show a preview before creating an event.",
        ].join("\n")
      );

      return Response.json({ ok: true });
    }

    if (text.startsWith("/finance add ")) {
      const rawFields = text
        .replace("/finance add ", "")
        .split("|")
        .map((field) => field.trim());

      if (rawFields.length !== 5) {
        await sendTelegramMessage(
          chatId,
          [
            "Invalid format.",
            "",
            "Use:",
            "/finance add expense | 14.80 | SGD | Food | Lunch at NUS",
          ].join("\n")
        );

        return Response.json({ ok: true });
      }

      const [type, amount, currency, category, description] = rawFields;

      const input = financeAddSchema.parse({
        type,
        amount,
        currency,
        category,
        description,
      });

      const transaction = await addTransaction(input);

      await sendTelegramMessage(
        chatId,
        [
          "Transaction added.",
          `ID: ${transaction.transactionId}`,
          `Type: ${input.type}`,
          `Amount: ${input.amount.toFixed(2)} ${input.currency.toUpperCase()}`,
          `Category: ${input.category}`,
          `Description: ${input.description}`,
        ].join("\n")
      );

      return Response.json({ ok: true });
    }

    if (text === "/finance list") {
      const rows = await listRecentTransactions();

      if (rows.length === 0) {
        await sendTelegramMessage(chatId, "No finance transactions found.");

        return Response.json({ ok: true });
      }

      const latestRows = rows.slice(-10).reverse();

      const formattedRows = latestRows.map((row) => {
        const [
          transactionId,
          timestamp,
          type,
          amount,
          currency,
          category,
          description,
        ] = row;

        return [
          `${type ?? "unknown"}: ${amount ?? "?"} ${currency ?? ""}`,
          `Category: ${category ?? "Uncategorized"}`,
          `Description: ${description ?? "No description"}`,
          `ID: ${transactionId ?? "Unknown"}`,
          `Recorded: ${timestamp ?? "Unknown"}`,
        ].join("\n");
      });

      await sendTelegramMessage(
        chatId,
        ["Recent transactions:", "", ...formattedRows].join("\n\n")
      );

      return Response.json({ ok: true });
    }

    const intent = await parseAssistantIntent(text);

    if (intent.action === "finance_add") {
      const transaction = await addTransaction({
        type: intent.type,
        amount: intent.amount,
        currency: intent.currency,
        category: intent.category,
        description: intent.description,
      });

      await sendTelegramMessage(
        chatId,
        [
          "Transaction added.",
          `ID: ${transaction.transactionId}`,
          `Type: ${intent.type}`,
          `Amount: ${intent.amount.toFixed(2)} ${intent.currency}`,
          `Category: ${intent.category}`,
          `Description: ${intent.description}`,
          `Date interpreted as: ${intent.transactionDate}`,
        ].join("\n")
      );

      return Response.json({ ok: true });
    }

    if (intent.action === "calendar_add") {
      const token = savePendingAction({
        type: "calendar_add",
        userId,
        payload: {
          calendarName: intent.calendarName,
          title: intent.title,
          start: intent.start,
          end: intent.end,
        },
      });

      await sendTelegramMessage(
        chatId,
        [
          "Create this calendar event?",
          "",
          `Calendar: ${intent.calendarName}`,
          `Title: ${intent.title}`,
          `Start: ${formatSingaporeDateTime(intent.start)}`,
          `End: ${formatSingaporeDateTime(intent.end)}`,
          "",
          `Reply /confirm ${token} to create it.`,
          "Reply /cancel to discard it.",
        ].join("\n")
      );

      return Response.json({ ok: true });
    }

    await sendTelegramMessage(
      chatId,
      `${intent.message ?? "I could not understand that request."}\n\nTry /help for examples.`
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);

    return Response.json(
      { ok: false, error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}