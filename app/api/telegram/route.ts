import { parseImageAssistantIntent } from "@/lib/image-intent";
import {
  downloadTelegramAudio,
  downloadTelegramPhoto,
} from "@/lib/telegram-files";
import { transcribeTelegramVoiceNote } from "@/lib/voice-transcribe";
import { z } from "zod";

import { parseAssistantIntent } from "@/lib/assistant-intent";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getUpcomingSchedule,
  ScheduleEventItem,
  searchUpcomingCalendarEvents,
} from "@/lib/calendar";
import {
  addTransaction,
  FinanceSummary,
  getFinanceSummary,
  hasProcessedUpdate,
  listRecentTransactions,
  markUpdateCompleted,
  markUpdateFailed,
  markUpdateStarted,
  searchActiveTransactions,
  softDeleteTransaction,
} from "@/lib/finance";
import {
  cancelPendingCalendarAction,
  cancelPendingCalendarBatchAction,
  cancelPendingCalendarDeleteAction,
  cancelPendingFinanceAddAction,
  cancelPendingFinanceDeleteAction,
  savePendingCalendarAction,
  savePendingCalendarBatchAction,
  savePendingCalendarDeleteAction,
  savePendingCalendarSelection,
  savePendingFinanceAddAction,
  savePendingFinanceDeleteAction,
  savePendingFinanceSelection,
  takePendingCalendarAction,
  takePendingCalendarBatchAction,
  takePendingCalendarDeleteAction,
  takePendingCalendarSelection,
  takePendingFinanceAddAction,
  takePendingFinanceDeleteAction,
  takePendingFinanceSelection,
} from "@/lib/pending-actions";
import {
  answerTelegramCallback,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
  setTelegramBotCommands,
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
      caption: z.string().optional(),
      photo: z
        .array(
          z.object({
            file_id: z.string(),
            file_unique_id: z.string(),
            width: z.number(),
            height: z.number(),
            file_size: z.number().optional(),
          })
        )
        .optional(),
      voice: z
        .object({
          file_id: z.string(),
          file_unique_id: z.string(),
          duration: z.number().optional(),
          mime_type: z.string().optional(),
          file_size: z.number().optional(),
        })
        .optional(),
      audio: z
        .object({
          file_id: z.string(),
          file_unique_id: z.string(),
          duration: z.number().optional(),
          mime_type: z.string().optional(),
          file_size: z.number().optional(),
        })
        .optional(),
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
    "You can write or send voice notes 🎤:",
    "• spent $6.20 for lunch",
    "• what's on my calendar today?",
    "• schedule floorball tomorrow from 8 pm to 9:30 pm",
    "• how much did I spend this month?",
    "• delete my coffee expense",
    "• delete gym tomorrow from personal",
    "",
    "You can send a screenshot or photo with a caption:",
    "• [calendar screenshot] Add these dates to my personal calendar",
    "• [receipt image] Log this receipt as an expense",
    "",
    "Commands:",
    "• /agenda — View today's schedule",
    "• /calendar list — View upcoming events (next 7 days)",
    "• /finance summary — View monthly spending breakdown",
    "• /finance list — View last 10 transactions",
    "• /setcommands — Update Telegram command menu",
    "• /help — Show this help message",
    "",
    "Tap Menu or type / to browse commands.",
  ].join("\n");
}

function formatSingaporeDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00+08:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
  }).format(date);
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

function truncateButtonText(value: string, maxLength = 58): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function formatFinanceTransaction(input: {
  type: string;
  amount: string;
  currency: string;
  category: string;
  description: string;
  transactionId: string;
  timestamp?: string;
}): string {
  return [
    `${input.type || "unknown"}: ${input.amount || "?"} ${input.currency}`,
    `Category: ${input.category || "Uncategorized"}`,
    `Description: ${input.description || "No description"}`,
    `ID: ${input.transactionId}`,
    input.timestamp ? `Recorded: ${input.timestamp}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCalendarEvent(input: {
  calendarName: "personal" | "work";
  title: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  date?: string;
  eventId?: string;
}): string {
  const timeLines =
    input.allDay || (!input.start && input.date)
      ? [
        `Date: ${formatCalendarDate(input.date ?? input.start ?? "")}`,
        "Time: All day",
      ]
      : [
        `Start: ${formatSingaporeDateTime(input.start ?? "")}`,
        `End: ${formatSingaporeDateTime(input.end ?? "")}`,
      ];

  return [
    `Calendar: ${input.calendarName}`,
    `Title: ${input.title}`,
    ...timeLines,
    input.eventId ? `Event ID: ${input.eventId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSingaporeScheduleItem(item: ScheduleEventItem): string {
  const calBadge = item.calendarName === "work" ? "💼 Work" : "🏠 Personal";
  if (item.isAllDay) {
    const dateFormatted = formatCalendarDate(item.start);
    return `• ${item.title}\n  📅 ${dateFormatted} (All day) [${calBadge}]`;
  }
  const startDate = new Date(item.start);
  const endDate = new Date(item.end);
  const dateStr = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(startDate);

  const startTimeStr = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(startDate);

  const endTimeStr = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(endDate);

  return `• ${item.title}\n  🕒 ${dateStr}, ${startTimeStr} – ${endTimeStr} [${calBadge}]`;
}

function formatFinanceSummary(summary: FinanceSummary): string {
  const periodTitles: Record<string, string> = {
    today: "Today",
    week: "Past 7 Days",
    month: "This Month",
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

async function removeAndSend(
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  await removeTelegramInlineKeyboard(chatId, messageId);
  await sendTelegramMessage(chatId, text);
}

async function handleCalendarCreateCallback(input: {
  callbackId: string;
  action: "calendar_yes" | "calendar_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  if (input.action === "calendar_no") {
    const cancelled = await cancelPendingCalendarAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Calendar event cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Calendar event creation cancelled."
        : "This calendar request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "calendar_create_cancelled");
    return;
  }

  const pendingAction = await takePendingCalendarAction(
    input.token,
    input.userId
  );

  if (!pendingAction) {
    await answerTelegramCallback(
      input.callbackId,
      "This confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This calendar request has expired or was already handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "calendar_create_confirmation_invalid"
    );
    return;
  }

  await answerTelegramCallback(input.callbackId, "Creating calendar event...");

  const event = await createCalendarEvent(pendingAction.payload);

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
    [
      "Calendar event created.",
      formatCalendarEvent(
        pendingAction.payload.allDay
          ? {
            calendarName: pendingAction.payload.calendarName,
            allDay: true,
            title: pendingAction.payload.title,
            date: pendingAction.payload.date,
          }
          : {
            calendarName: pendingAction.payload.calendarName,
            allDay: false,
            title: pendingAction.payload.title,
            start: pendingAction.payload.start,
            end: pendingAction.payload.end,
          }
      ),
      `Event ID: ${event.id}`,
      event.htmlLink ? `Link: ${event.htmlLink}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  await markUpdateCompleted(input.updateId, "calendar_add");

  log("telegram.webhook.completed", {
    updateId: input.updateId,
    action: "calendar_add",
    durationMs: Date.now() - input.startedAt,
  });
}

async function handleCalendarBatchCreateCallback(input: {
  callbackId: string;
  action: "calendar_batch_yes" | "calendar_batch_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  if (input.action === "calendar_batch_no") {
    const cancelled = await cancelPendingCalendarBatchAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Calendar batch cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Calendar batch creation cancelled."
        : "This calendar batch request has already expired or was handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "calendar_batch_create_cancelled"
    );
    return;
  }

  const batch = await takePendingCalendarBatchAction(
    input.token,
    input.userId
  );

  if (!batch || !batch.events.length) {
    await answerTelegramCallback(
      input.callbackId,
      "This confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This calendar batch request has expired or was already handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "calendar_batch_create_confirmation_invalid"
    );
    return;
  }

  await answerTelegramCallback(
    input.callbackId,
    `Creating ${batch.events.length} calendar events...`
  );

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  const createdItems: string[] = [];

  for (const eventItem of batch.events) {
    const payload = eventItem.allDay
      ? {
          calendarName: batch.calendarName,
          allDay: true as const,
          title: eventItem.title,
          date: eventItem.date,
        }
      : {
          calendarName: batch.calendarName,
          allDay: false as const,
          title: eventItem.title,
          start: eventItem.start,
          end: eventItem.end,
        };

    await createCalendarEvent(payload);

    const timing = eventItem.allDay
      ? `${formatCalendarDate(eventItem.date)} (All day)`
      : `${formatSingaporeDateTime(eventItem.start)} – ${formatSingaporeDateTime(eventItem.end)}`;

    createdItems.push(`• ${eventItem.title}\n  ${timing}`);
  }

  await sendTelegramMessage(
    input.chatId,
    [
      `✅ Created ${batch.events.length} ${batch.calendarName} calendar events:`,
      "",
      createdItems.join("\n\n"),
    ].join("\n")
  );

  await markUpdateCompleted(input.updateId, "calendar_batch_add");

  log("telegram.webhook.completed", {
    updateId: input.updateId,
    action: "calendar_batch_add",
    eventCount: batch.events.length,
    durationMs: Date.now() - input.startedAt,
  });
}

async function handleFinanceSelectionCallback(input: {
  callbackId: string;
  selectionToken: string;
  selectedIndex: number;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  const selection = await takePendingFinanceSelection(
    input.selectionToken,
    input.userId
  );

  const transactionId = selection?.transactionIds[input.selectedIndex];

  if (!transactionId) {
    await answerTelegramCallback(
      input.callbackId,
      "This selection has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This finance selection has expired or was already handled."
    );

    await markUpdateCompleted(input.updateId, "finance_selection_invalid");
    return;
  }

  const matches = await searchActiveTransactions(transactionId);
  const transaction = matches.find(
    (candidate) => candidate.transactionId === transactionId
  );

  if (!transaction) {
    await answerTelegramCallback(input.callbackId, "Transaction not found.");

    await removeAndSend(
      input.chatId,
      input.messageId,
      "That transaction is no longer active, so it cannot be deleted."
    );

    await markUpdateCompleted(input.updateId, "finance_selection_not_found");
    return;
  }

  const confirmationToken = await savePendingFinanceDeleteAction({
    userId: input.userId,
    payload: { transactionId },
  });

  await answerTelegramCallback(input.callbackId, "Transaction selected.");
  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
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

  await markUpdateCompleted(input.updateId, "finance_delete_confirmation_sent");
}

async function handleCalendarSelectionCallback(input: {
  callbackId: string;
  selectionToken: string;
  selectedIndex: number;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  const selection = await takePendingCalendarSelection(
    input.selectionToken,
    input.userId
  );

  const event = selection?.events[input.selectedIndex];

  if (!selection || !event) {
    await answerTelegramCallback(
      input.callbackId,
      "This selection has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This calendar selection has expired or was already handled."
    );

    await markUpdateCompleted(input.updateId, "calendar_selection_invalid");
    return;
  }

  const confirmationToken = await savePendingCalendarDeleteAction({
    userId: input.userId,
    payload: {
      calendarName: selection.calendarName,
      eventId: event.eventId,
    },
  });

  await answerTelegramCallback(input.callbackId, "Calendar event selected.");
  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
    [
      "Delete this calendar event?",
      "",
      formatCalendarEvent({
        calendarName: selection.calendarName,
        title: event.title,
        start: event.start,
        end: event.end,
        eventId: event.eventId,
      }),
      "",
      "This permanently deletes the event from Google Calendar.",
    ].join("\n"),
    {
      inline_keyboard: [
        [
          {
            text: "🗑️ Yes, delete",
            callback_data: `calendar_delete_yes:${confirmationToken}`,
          },
          {
            text: "❌ No, keep it",
            callback_data: `calendar_delete_no:${confirmationToken}`,
          },
        ],
      ],
    }
  );

  await markUpdateCompleted(
    input.updateId,
    "calendar_delete_confirmation_sent"
  );
}

async function handleFinanceAddCallback(input: {
  callbackId: string;
  action: "finance_add_yes" | "finance_add_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  if (input.action === "finance_add_no") {
    const cancelled = await cancelPendingFinanceAddAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Transaction cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Finance transaction logging cancelled."
        : "This finance request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "finance_add_cancelled");
    return;
  }

  const payload = await takePendingFinanceAddAction(
    input.token,
    input.userId
  );

  if (!payload) {
    await answerTelegramCallback(
      input.callbackId,
      "This confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This finance request has expired or was already handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "finance_add_confirmation_invalid"
    );
    return;
  }

  await answerTelegramCallback(input.callbackId, "Adding transaction...");

  const transaction = await addTransaction({
    type: payload.type,
    amount: payload.amount,
    currency: payload.currency,
    category: payload.category,
    description: payload.description,
    transactionDate: payload.transactionDate,
  });

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
    [
      "Transaction added.",
      `ID: ${transaction.transactionId}`,
      `Type: ${payload.type}`,
      `Amount: ${payload.amount.toFixed(2)} ${payload.currency}`,
      `Category: ${payload.category}`,
      `Description: ${payload.description}`,
      `Date interpreted as: ${payload.transactionDate}`,
    ].join("\n")
  );

  await markUpdateCompleted(input.updateId, "finance_add");

  log("telegram.webhook.completed", {
    updateId: input.updateId,
    action: "finance_add",
    durationMs: Date.now() - input.startedAt,
  });
}

async function handleFinanceDeleteCallback(input: {
  callbackId: string;
  action: "finance_delete_yes" | "finance_delete_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  if (input.action === "finance_delete_no") {
    const cancelled = await cancelPendingFinanceDeleteAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Deletion cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Finance transaction was kept."
        : "This finance deletion request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "finance_delete_cancelled");
    return;
  }

  const pendingAction = await takePendingFinanceDeleteAction(
    input.token,
    input.userId
  );

  if (!pendingAction) {
    await answerTelegramCallback(
      input.callbackId,
      "This confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This finance deletion request has expired or was already handled."
    );

    await markUpdateCompleted(input.updateId, "finance_delete_invalid");
    return;
  }

  await answerTelegramCallback(input.callbackId, "Deleting transaction...");

  const transaction = await softDeleteTransaction(
    pendingAction.transactionId
  );

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  if (!transaction) {
    await sendTelegramMessage(
      input.chatId,
      "That transaction was already deleted or could not be found."
    );

    await markUpdateCompleted(input.updateId, "finance_delete_not_found");
    return;
  }

  await sendTelegramMessage(
    input.chatId,
    [
      "Finance transaction deleted.",
      "",
      formatFinanceTransaction(transaction),
      "",
      "The Google Sheets row was retained with status: deleted.",
    ].join("\n")
  );

  await markUpdateCompleted(input.updateId, "finance_delete");
}

async function handleCalendarDeleteCallback(input: {
  callbackId: string;
  action: "calendar_delete_yes" | "calendar_delete_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  if (input.action === "calendar_delete_no") {
    const cancelled = await cancelPendingCalendarDeleteAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Deletion cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Calendar event was kept."
        : "This calendar deletion request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "calendar_delete_cancelled");
    return;
  }

  const pendingAction = await takePendingCalendarDeleteAction(
    input.token,
    input.userId
  );

  if (!pendingAction) {
    await answerTelegramCallback(
      input.callbackId,
      "This confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This calendar deletion request has expired or was already handled."
    );

    await markUpdateCompleted(input.updateId, "calendar_delete_invalid");
    return;
  }

  await answerTelegramCallback(
    input.callbackId,
    "Deleting calendar event..."
  );

  await deleteCalendarEvent(pendingAction);

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
    `Calendar event deleted from ${pendingAction.calendarName}.`
  );

  await markUpdateCompleted(input.updateId, "calendar_delete");
}

async function handleCallback(input: {
  callbackId: string;
  callbackData: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  const parts = input.callbackData.split(":");
  const action = parts[0];

  if (action === "finance_add_yes" || action === "finance_add_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleFinanceAddCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  if (action === "calendar_batch_yes" || action === "calendar_batch_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleCalendarBatchCreateCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  if (action === "calendar_yes" || action === "calendar_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleCalendarCreateCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  if (action === "finance_select") {
    const selectionToken = parts[1];
    const selectedIndex = Number(parts[2]);

    if (
      !selectionToken ||
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0
    ) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleFinanceSelectionCallback({
      ...input,
      selectionToken,
      selectedIndex,
    });

    return;
  }

  if (action === "calendar_select") {
    const selectionToken = parts[1];
    const selectedIndex = Number(parts[2]);

    if (
      !selectionToken ||
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0
    ) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleCalendarSelectionCallback({
      ...input,
      selectionToken,
      selectedIndex,
    });

    return;
  }

  if (action === "finance_delete_yes" || action === "finance_delete_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleFinanceDeleteCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  if (action === "calendar_delete_yes" || action === "calendar_delete_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleCalendarDeleteCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  await answerTelegramCallback(input.callbackId, "This action is invalid.");
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
      await handleCallback({
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

    if (!message) {
      await markUpdateCompleted(updateId, "ignored_no_message");

      return Response.json({ ok: true });
    }

    const chatId = message.chat.id;

    if (message.photo?.length) {
      const instruction = message.caption?.trim() ?? "";
      const largestPhoto = message.photo[message.photo.length - 1];

      if (!instruction) {
        await sendTelegramMessage(
          chatId,
          [
            "I received your image.",
            "",
            "Please resend it with an instruction in the caption, for example:",
            "• Add these dates to my personal calendar",
            "• Add these dates to my work calendar",
            "• Log this receipt as an expense",
          ].join("\n")
        );

        await markUpdateCompleted(updateId, "image_missing_instruction");

        return Response.json({ ok: true });
      }

      await sendTelegramMessage(chatId, "Reading your image...");

      const downloadedImage = await downloadTelegramPhoto(largestPhoto.file_id);

      const imageIntent = await parseImageAssistantIntent({
        instruction,
        image: downloadedImage.data,
        mediaType: downloadedImage.mediaType,
      });

      log("telegram.image_intent.parsed", {
        updateId,
        action: imageIntent.action,
        imageBytes: downloadedImage.data.byteLength,
      });

      if (imageIntent.action === "unknown") {
        await sendTelegramMessage(
          chatId,
          `${imageIntent.message}\n\nPlease send a clearer image or add more detail in the caption.`
        );

        await markUpdateCompleted(updateId, "image_unknown");

        return Response.json({ ok: true });
      }

      if (imageIntent.action === "finance_from_image") {
        const token = await savePendingFinanceAddAction({
          userId: message.from.id,
          payload: {
            type: imageIntent.type,
            amount: imageIntent.amount,
            currency: imageIntent.currency,
            category: imageIntent.category,
            description: imageIntent.description,
            transactionDate: imageIntent.transactionDate,
          },
        });

        await sendTelegramMessage(
          chatId,
          [
            "I found this transaction in the image. Log it?",
            "",
            `Type: ${imageIntent.type}`,
            `Amount: ${imageIntent.amount.toFixed(2)} ${imageIntent.currency}`,
            `Category: ${imageIntent.category}`,
            `Description: ${imageIntent.description}`,
            `Date: ${imageIntent.transactionDate}`,
          ].join("\n"),
          {
            inline_keyboard: [
              [
                {
                  text: "✅ Yes, log",
                  callback_data: `finance_add_yes:${token}`,
                },
                {
                  text: "❌ No, cancel",
                  callback_data: `finance_add_no:${token}`,
                },
              ],
            ],
          }
        );

        await markUpdateCompleted(updateId, "image_finance_pending");

        return Response.json({ ok: true });
      }

      if (imageIntent.action === "calendar_from_image") {
        if (!imageIntent.events.length) {
          await sendTelegramMessage(
            chatId,
            "I could not find any clear calendar events in that image."
          );

          await markUpdateCompleted(updateId, "image_calendar_empty");

          return Response.json({ ok: true });
        }

        if (imageIntent.events.length === 1) {
          const event = imageIntent.events[0];

          const payload = event.allDay
            ? {
              calendarName: imageIntent.calendarName,
              allDay: true as const,
              title: event.title,
              date: event.date,
            }
            : {
              calendarName: imageIntent.calendarName,
              allDay: false as const,
              title: event.title,
              start: event.start,
              end: event.end,
            };

          const token = await savePendingCalendarAction({
            userId: message.from.id,
            payload,
          });

          await sendTelegramMessage(
            chatId,
            [
              "I found this event in the image. Create it?",
              "",
              event.allDay
                ? [
                  `Calendar: ${imageIntent.calendarName}`,
                  `Title: ${event.title}`,
                  `Date: ${formatCalendarDate(event.date)}`,
                  "Time: All day",
                ].join("\n")
                : [
                  `Calendar: ${imageIntent.calendarName}`,
                  `Title: ${event.title}`,
                  `Start: ${formatSingaporeDateTime(event.start)}`,
                  `End: ${formatSingaporeDateTime(event.end)}`,
                ].join("\n"),
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

          await markUpdateCompleted(updateId, "image_calendar_pending");

          return Response.json({ ok: true });
        }

        // Multiple events: Batch Review
        const token = await savePendingCalendarBatchAction({
          userId: message.from.id,
          payload: {
            calendarName: imageIntent.calendarName,
            events: imageIntent.events,
          },
        });

        const eventPreviews = imageIntent.events.map((ev, idx) => {
          const timing = ev.allDay
            ? `${formatCalendarDate(ev.date)} (All day)`
            : `${formatSingaporeDateTime(ev.start)} – ${formatSingaporeDateTime(ev.end)}`;
          return `${idx + 1}. ${ev.title}\n   📅 ${timing}`;
        });

        await sendTelegramMessage(
          chatId,
          [
            `I found ${imageIntent.events.length} events for your ${imageIntent.calendarName} calendar:`,
            "",
            eventPreviews.join("\n\n"),
            "",
            `Create all ${imageIntent.events.length} events?`,
          ].join("\n"),
          {
            inline_keyboard: [
              [
                {
                  text: `✅ Yes, create all (${imageIntent.events.length})`,
                  callback_data: `calendar_batch_yes:${token}`,
                },
                {
                  text: "❌ No, cancel",
                  callback_data: `calendar_batch_no:${token}`,
                },
              ],
            ],
          }
        );

        await markUpdateCompleted(updateId, "image_calendar_batch_pending");

        return Response.json({ ok: true });
      }

      await markUpdateCompleted(updateId, "image_unhandled");

      return Response.json({ ok: true });
    }

    let text = message.text?.trim() ?? "";

    if (!text && (message.voice || message.audio)) {
      const audioObj = message.voice || message.audio;
      if (audioObj) {
        await sendTelegramMessage(chatId, "🎧 Listening to your voice note...");
        try {
          const downloaded = await downloadTelegramAudio(
            audioObj.file_id,
            audioObj.mime_type
          );
          const transcription = await transcribeTelegramVoiceNote({
            audio: downloaded.data,
            mediaType: downloaded.mediaType,
          });

          if (!transcription) {
            await sendTelegramMessage(
              chatId,
              "I couldn't hear any words in that voice note. Please try again."
            );
            await markUpdateCompleted(updateId, "voice_empty");
            return Response.json({ ok: true });
          }

          await sendTelegramMessage(chatId, `🎤 Heard: “${transcription}”`);
          text = transcription;
        } catch (voiceError) {
          log("telegram.voice_transcribe.failed", {
            updateId,
            error: errorText(voiceError),
          });
          await sendTelegramMessage(
            chatId,
            "Sorry, I had trouble processing that voice note. Please try typing your message."
          );
          await markUpdateFailed(updateId, errorText(voiceError));
          return Response.json({ ok: true });
        }
      }
    }

    if (!text) {
      await markUpdateCompleted(updateId, "ignored_no_text");

      return Response.json({ ok: true });
    }

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

    if (text === "/setcommands") {
      await setTelegramBotCommands([
        { command: "agenda", description: "View today's schedule" },
        { command: "calendar", description: "Calendar commands & upcoming events" },
        { command: "finance", description: "Finance commands & summary" },
        { command: "finance_summary", description: "Monthly spending & breakdown" },
        { command: "finance_list", description: "Recent active transactions" },
        { command: "help", description: "Show help and example usage" },
      ]);

      await sendTelegramMessage(
        chatId,
        "✅ Telegram bot command menu has been updated! Tap Menu or type / to see the commands."
      );
      await markUpdateCompleted(updateId, "set_commands");
      return Response.json({ ok: true });
    }

    if (text === "/agenda" || text === "/calendar today") {
      const now = new Date();
      const sgTodayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);

      const timeMin = `${sgTodayStr}T00:00:00+08:00`;
      const timeMax = `${sgTodayStr}T23:59:59+08:00`;

      const events = await getUpcomingSchedule({
        timeMin,
        timeMax,
        maxResults: 20,
      });

      if (events.length === 0) {
        await sendTelegramMessage(
          chatId,
          `📅 No events scheduled for today (${formatCalendarDate(sgTodayStr)}). Enjoy your day!`
        );
      } else {
        const formatted = events.map(formatSingaporeScheduleItem).join("\n\n");
        await sendTelegramMessage(
          chatId,
          [`📅 Today’s Schedule (${formatCalendarDate(sgTodayStr)}):`, "", formatted].join("\n")
        );
      }

      await markUpdateCompleted(updateId, "agenda_today");
      return Response.json({ ok: true });
    }

    if (text === "/calendar list" || text === "/calendar upcoming") {
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const events = await getUpcomingSchedule({
        timeMin: now.toISOString(),
        timeMax: nextWeek.toISOString(),
        maxResults: 25,
      });

      if (events.length === 0) {
        await sendTelegramMessage(
          chatId,
          "📅 No upcoming calendar events found for the next 7 days."
        );
      } else {
        const formatted = events.map(formatSingaporeScheduleItem).join("\n\n");
        await sendTelegramMessage(
          chatId,
          ["📅 Upcoming Schedule (Next 7 days):", "", formatted].join("\n")
        );
      }

      await markUpdateCompleted(updateId, "calendar_upcoming");
      return Response.json({ ok: true });
    }

    if (text === "/finance") {
      await sendTelegramMessage(
        chatId,
        [
          "Finance assistant:",
          "",
          "Write or speak naturally:",
          "• spent $6.20 for lunch",
          "• earned $100 from freelance work",
          "• how much did I spend this month?",
          "• delete my coffee expense",
          "",
          "Or use commands:",
          "• /finance summary — View monthly spending breakdown",
          "• /finance list — View last 10 active transactions",
        ].join("\n")
      );

      await markUpdateCompleted(updateId, "finance_help");
      return Response.json({ ok: true });
    }

    if (
      text === "/finance summary" ||
      text.startsWith("/finance summary ") ||
      text === "/finance_summary" ||
      text.startsWith("/finance_summary ")
    ) {
      const subArg = text
        .replace("/finance_summary", "")
        .replace("/finance summary", "")
        .trim()
        .toLowerCase();

      let period: "today" | "week" | "month" | "all" = "month";
      if (subArg === "today") period = "today";
      else if (subArg === "week") period = "week";
      else if (subArg === "all") period = "all";

      const summary = await getFinanceSummary(period);
      await sendTelegramMessage(chatId, formatFinanceSummary(summary));

      await markUpdateCompleted(updateId, "finance_summary_command");
      return Response.json({ ok: true });
    }

    if (text === "/calendar") {
      await sendTelegramMessage(
        chatId,
        [
          "Calendar assistant:",
          "",
          "Write or speak naturally:",
          "• Add gym tomorrow",
          "• What's on my calendar today?",
          "• Schedule floorball tomorrow from 8 pm to 9:30 pm",
          "• Add project meeting next Friday from 2 pm to 3 pm in work",
          "• Delete gym tomorrow from personal",
          "",
          "Commands:",
          "• /agenda — View today's schedule",
          "• /calendar list — View upcoming events (next 7 days)",
          "",
          "Send screenshot photos:",
          "• [calendar screenshot] Add these dates to my personal calendar",
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

    if (text === "/finance list" || text === "/finance_list") {
      const transactions = await listRecentTransactions();

      if (transactions.length === 0) {
        await sendTelegramMessage(chatId, "No active finance transactions found.");
        await markUpdateCompleted(updateId, "finance_list_empty");
        return Response.json({ ok: true });
      }

      await sendTelegramMessage(
        chatId,
        [
          "Recent active transactions:",
          "",
          ...transactions
            .slice(-10)
            .reverse()
            .map((transaction) => formatFinanceTransaction(transaction)),
        ].join("\n\n")
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
        transactionDate: intent.transactionDate,
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

    if (intent.action === "calendar_view") {
      const now = new Date();
      let timeMin: string | undefined;
      let timeMax: string | undefined;
      let titleHeader = "Upcoming Events";

      const sgTodayStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);

      if (intent.timeframe === "today") {
        timeMin = `${sgTodayStr}T00:00:00+08:00`;
        timeMax = `${sgTodayStr}T23:59:59+08:00`;
        titleHeader = `Today’s Schedule (${formatCalendarDate(sgTodayStr)})`;
      } else if (intent.timeframe === "tomorrow") {
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const sgTomorrowStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Singapore",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(tomorrow);
        timeMin = `${sgTomorrowStr}T00:00:00+08:00`;
        timeMax = `${sgTomorrowStr}T23:59:59+08:00`;
        titleHeader = `Tomorrow’s Schedule (${formatCalendarDate(sgTomorrowStr)})`;
      } else if (intent.timeframe === "week") {
        const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        timeMin = now.toISOString();
        timeMax = weekEnd.toISOString();
        titleHeader = "Schedule for Next 7 Days";
      } else {
        timeMin = now.toISOString();
        titleHeader = "Upcoming Calendar Events";
      }

      const events = await getUpcomingSchedule({
        calendarName: intent.calendarName,
        timeMin,
        timeMax,
        maxResults: 15,
      });

      if (events.length === 0) {
        await sendTelegramMessage(
          chatId,
          `📅 No events found for ${
            intent.timeframe === "today"
              ? "today"
              : intent.timeframe === "tomorrow"
              ? "tomorrow"
              : "this period"
          }.`
        );
      } else {
        const formatted = events.map(formatSingaporeScheduleItem).join("\n\n");
        await sendTelegramMessage(
          chatId,
          [`📅 ${titleHeader}:`, "", formatted].join("\n")
        );
      }

      await markUpdateCompleted(updateId, "calendar_view");
      return Response.json({ ok: true });
    }

    if (intent.action === "finance_summary") {
      const summary = await getFinanceSummary(intent.period);
      await sendTelegramMessage(chatId, formatFinanceSummary(summary));

      await markUpdateCompleted(updateId, "finance_summary");
      return Response.json({ ok: true });
    }

    if (intent.action === "calendar_add") {
      const payload = intent.allDay
        ? {
          calendarName: intent.calendarName,
          allDay: true as const,
          title: intent.title,
          date: intent.date,
        }
        : {
          calendarName: intent.calendarName,
          allDay: false as const,
          title: intent.title,
          start: intent.start,
          end: intent.end,
        };

      const token = await savePendingCalendarAction({
        userId: message.from.id,
        payload,
      });

      await sendTelegramMessage(
        chatId,
        [
          "Create this calendar event?",
          "",
          formatCalendarEvent(
            intent.allDay
              ? {
                calendarName: intent.calendarName,
                allDay: true,
                title: intent.title,
                date: intent.date,
              }
              : {
                calendarName: intent.calendarName,
                allDay: false,
                title: intent.title,
                start: intent.start,
                end: intent.end,
              }
          ),
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

    if (intent.action === "finance_delete_search") {
      const matches = await searchActiveTransactions(intent.query);

      if (matches.length === 0) {
        await sendTelegramMessage(
          chatId,
          `No active finance transactions matched “${intent.query}”.`
        );

        await markUpdateCompleted(updateId, "finance_delete_search_empty");
        return Response.json({ ok: true });
      }

      const limitedMatches = matches.slice(0, 5);

      const selectionToken = await savePendingFinanceSelection({
        userId: message.from.id,
        transactionIds: limitedMatches.map(
          (transaction) => transaction.transactionId
        ),
      });

      await sendTelegramMessage(
        chatId,
        [
          `Found ${limitedMatches.length} active finance match${limitedMatches.length === 1 ? "" : "es"
          } for “${intent.query}”.`,
          "",
          "Choose the exact transaction to delete:",
        ].join("\n"),
        {
          inline_keyboard: limitedMatches.map((transaction, index) => [
            {
              text: truncateButtonText(
                `${transaction.type}: ${transaction.amount} ${transaction.currency} — ${transaction.description}`
              ),
              callback_data: `finance_select:${selectionToken}:${index}`,
            },
          ]),
        }
      );

      await markUpdateCompleted(updateId, "finance_delete_search_found");
      return Response.json({ ok: true });
    }

    if (intent.action === "calendar_delete_search") {
      const matches = await searchUpcomingCalendarEvents({
        calendarName: intent.calendarName,
        query: intent.query,
      });

      if (matches.length === 0) {
        await sendTelegramMessage(
          chatId,
          `No upcoming ${intent.calendarName} calendar events matched “${intent.query}”.`
        );

        await markUpdateCompleted(updateId, "calendar_delete_search_empty");
        return Response.json({ ok: true });
      }

      const limitedMatches = matches.slice(0, 5);

      const selectionToken = await savePendingCalendarSelection({
        userId: message.from.id,
        calendarName: intent.calendarName,
        events: limitedMatches.map((event) => ({
          eventId: event.eventId,
          title: event.title,
          start: event.start,
          end: event.end,
        })),
      });

      await sendTelegramMessage(
        chatId,
        [
          `Found ${limitedMatches.length} upcoming ${intent.calendarName} calendar match${limitedMatches.length === 1 ? "" : "es"
          } for “${intent.query}”.`,
          "",
          "Choose the exact event to delete:",
        ].join("\n"),
        {
          inline_keyboard: limitedMatches.map((event, index) => [
            {
              text: truncateButtonText(
                `${event.title} — ${formatSingaporeDateTime(event.start)}`
              ),
              callback_data: `calendar_select:${selectionToken}:${index}`,
            },
          ]),
        }
      );

      await markUpdateCompleted(updateId, "calendar_delete_search_found");
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

    const exhaustiveIntentCheck: never = intent;

    throw new Error(
      `Unhandled assistant intent: ${JSON.stringify(exhaustiveIntentCheck)}`
    );
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