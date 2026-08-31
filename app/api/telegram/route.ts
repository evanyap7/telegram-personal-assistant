import { z } from "zod";

import { parseAssistantIntent } from "@/lib/assistant-intent";
import { createCalendarEvent } from "@/lib/calendar";
import {
  addTransaction,
  hasProcessedUpdate,
  listRecentTransactions,
  markUpdateCompleted,
  markUpdateFailed,
  markUpdateStarted,
} from "@/lib/finance";
import {
  cancelPendingCalendarAction,
  savePendingCalendarAction,
  takePendingCalendarAction,
} from "@/lib/pending-actions";
import {
  answerTelegramCallback,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
} from "@/lib/telegram";

const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({
        id: z.number(),
      }),
      from: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: z.object({
        id: z.number(),
      }),
      data: z.string().optional(),
      message: z.object({
        message_id: z.number(),
        chat: z.object({
          id: z.number(),
        }),
      }),
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
    "• schedule floorball tomorrow from 8 pm to 9:30 pm",
    "",
    "Finance entries are saved after I understand them.",
    "Calendar changes require a Yes / No confirmation.",
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

function sanitizeText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/pplx-[A-Za-z0-9._-]+/gi, "pplx-[REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/gi, "sk-[REDACTED]");
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & {
      statusCode?: number;
      responseBody?: string;
      url?: string;
      cause?: unknown;
    };

    return sanitizeText(
      JSON.stringify({
        name: details.name,
        message: details.message,
        statusCode: details.statusCode ?? null,
        url: details.url ?? null,
        responseBody: details.responseBody ?? null,
        cause:
          details.cause instanceof Error
            ? details.cause.message
            : details.cause ?? null,
      })
    );
  }

  return sanitizeText(String(error));
}

function log(event: string, values: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...values,
    })
  );
}

async function handleCalendarCallback(input: {
  callbackId: string;
  callbackData: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  const {
    callbackId,
    callbackData,
    userId,
    chatId,
    messageId,
    updateId,
    startedAt,
  } = input;

  const [action, token] = callbackData.split(":");

  if (!token || !["calendar_yes", "calendar_no"].includes(action)) {
    await answerTelegramCallback(callbackId, "This action is invalid.");
    return;
  }

  if (action === "calendar_no") {
    const cancelled = await cancelPendingCalendarAction(token, userId);

    await answerTelegramCallback(
      callbackId,
      cancelled ? "Calendar event cancelled." : "This request has expired."
    );

    await removeTelegramInlineKeyboard(chatId, messageId);

    await sendTelegramMessage(
      chatId,
      cancelled
        ? "Calendar event creation cancelled."
        : "This calendar request has already expired or was handled."
    );

    await markUpdateCompleted(updateId, "calendar_cancelled");

    return;
  }

  const pendingAction = await takePendingCalendarAction(token, userId);

  if (!pendingAction) {
    await answerTelegramCallback(
      callbackId,
      "This confirmation has expired or was already used."
    );

    await removeTelegramInlineKeyboard(chatId, messageId);

    await sendTelegramMessage(
      chatId,
      "This calendar request has expired or was already handled."
    );

    await markUpdateCompleted(updateId, "calendar_confirm_invalid");

    return;
  }

  await answerTelegramCallback(callbackId, "Creating calendar event...");

  const event = await createCalendarEvent(pendingAction.payload);

  await removeTelegramInlineKeyboard(chatId, messageId);

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

  await markUpdateCompleted(updateId, "calendar_add");

  log("telegram.webhook.completed", {
    updateId,
    action: "calendar_add",
    durationMs: Date.now() - startedAt,
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  const secretHeader = request.headers.get(
    "x-telegram-bot-api-secret-token"
  );

  if (secretHeader !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    log("telegram.webhook.unauthorized");

    return new Response("Unauthorized", { status: 401 });
  }

  let updateId: number | null = null;

  try {
    const update = telegramUpdateSchema.parse(await request.json());
    updateId = update.update_id;

    const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);

    if (!allowedUserId) {
      throw new Error("TELEGRAM_ALLOWED_USER_ID is missing.");
    }

    const senderId = update.message?.from.id ?? update.callback_query?.from.id;

    if (!senderId || senderId !== allowedUserId) {
      log("telegram.webhook.forbidden", {
        updateId,
        senderId,
      });

      return new Response("Forbidden", { status: 403 });
    }

    const alreadyProcessed = await hasProcessedUpdate(updateId);

    if (alreadyProcessed) {
      log("telegram.webhook.duplicate_skipped", {
        updateId,
        durationMs: Date.now() - startedAt,
      });

      return Response.json({ ok: true });
    }

    await markUpdateStarted(updateId);

    if (update.callback_query?.data) {
      await handleCalendarCallback({
        callbackId: update.callback_query.id,
        callbackData: update.callback_query.data,
        userId: update.callback_query.from.id,
        chatId: update.callback_query.message.chat.id,
        messageId: update.callback_query.message.message_id,
        updateId,
        startedAt,
      });

      return Response.json({ ok: true });
    }

    const message = update.message;

    if (!message?.text) {
      await markUpdateCompleted(updateId, "ignored_no_text");

      return Response.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    log("telegram.webhook.received", {
      updateId,
      chatId,
      textLength: text.length,
    });

    if (!text.startsWith("/")) {
      await sendTelegramMessage(chatId, "Processing your request...");
    }

    if (text === "/start" || text === "/help") {
      await sendTelegramMessage(chatId, helpText());
      await markUpdateCompleted(updateId, "help");

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

      await markUpdateCompleted(updateId, "finance_help");

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
          "I will show Yes / No buttons before creating an event.",
        ].join("\n")
      );

      await markUpdateCompleted(updateId, "calendar_help");

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
          "Invalid format. Use /finance add expense | 14.80 | SGD | Food | Lunch"
        );

        await markUpdateCompleted(updateId, "finance_add_invalid");

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

      await markUpdateCompleted(updateId, "finance_add_command");

      return Response.json({ ok: true });
    }

    if (text === "/finance list") {
      const rows = await listRecentTransactions();

      if (rows.length === 0) {
        await sendTelegramMessage(chatId, "No finance transactions found.");
        await markUpdateCompleted(updateId, "finance_list_empty");

        return Response.json({ ok: true });
      }

      const formattedRows = rows
        .slice(-10)
        .reverse()
        .map((row) => {
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

      await markUpdateCompleted(updateId, "finance_list");

      return Response.json({ ok: true });
    }

    const intentStartAt = Date.now();
    const intent = await parseAssistantIntent(text);

    log("telegram.intent.parsed", {
      updateId,
      action: intent.action,
      durationMs: Date.now() - intentStartAt,
    });

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

      await markUpdateCompleted(updateId, "finance_add_natural_language");

      return Response.json({ ok: true });
    }

    if (intent.action === "calendar_add") {
      const token = await savePendingCalendarAction({
        userId: message.from.id,
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
        ].join("\n"),
        {
          inline_keyboard: [
            [
              {
                text: "✅ Yes, create",
                callback_data: `calendar_yes:${token}`,
              },
              {
                text: "❌ No, cancel",
                callback_data: `calendar_no:${token}`,
              },
            ],
          ],
        }
      );

      await markUpdateCompleted(updateId, "calendar_add_pending");

      return Response.json({ ok: true });
    }

    if (intent.action === "unknown") {
  await sendTelegramMessage(
    chatId,
    `${intent.message}\n\nTry /help for examples.`
  );

  await markUpdateCompleted(updateId, "unknown");

  return Response.json({ ok: true });
}

await sendTelegramMessage(
  chatId,
  "I understood your request, but that action is not implemented yet."
);

await markUpdateCompleted(updateId, "not_implemented");

return Response.json({ ok: true });
  } catch (error) {
    const message = errorText(error);

    log("telegram.webhook.failed", {
      updateId,
      error: message,
      durationMs: Date.now() - startedAt,
    });

    if (updateId !== null) {
      try {
        await markUpdateFailed(updateId, message);
      } catch (loggingError) {
        log("telegram.update_log.failed", {
          updateId,
          error: errorText(loggingError),
        });
      }
    }

    return Response.json(
      { ok: false, error: "Webhook processing failed." },
      { status: 500 }
    );
  }
}