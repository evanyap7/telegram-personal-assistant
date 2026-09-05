import { parseImageAssistantIntent } from "@/lib/image-intent";
import {
  downloadTelegramAudio,
  downloadTelegramPhoto,
} from "@/lib/telegram-files";
import { transcribeTelegramVoiceNote } from "@/lib/voice-transcribe";
import { z } from "zod";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  getUpcomingSchedule,
  moveCalendarEvent,
  ScheduleEventItem,
  searchUpcomingCalendarEvents,
} from "@/lib/calendar";
import {
  addTransaction,
  addTransactionsBatch,
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
  cancelActivePendingCalendarAction,
  cancelPendingCalendarAction,
  cancelPendingCalendarBatchAction,
  cancelPendingCalendarDeleteAction,
  cancelPendingEmailDraftAction,
  cancelPendingFinanceAddAction,
  cancelPendingFinanceBatchAction,
  cancelPendingFinanceDeleteAction,
  cancelPendingTodoDeleteAction,
  consumePendingImage,
  getLatestPendingImage,
  getLatestUserCalendarContext,
  recordConfirmedCalendarEvent,
  savePendingCalendarAction,
  savePendingCalendarBatchAction,
  savePendingCalendarDeleteAction,
  savePendingCalendarSelection,
  savePendingEmailDraftAction,
  savePendingFinanceAddAction,
  savePendingFinanceBatchAction,
  savePendingFinanceDeleteAction,
  savePendingFinanceSelection,
  savePendingImageAction,
  savePendingTodoDeleteAction,
  savePendingTodoSelection,
  takePendingCalendarAction,
  takePendingCalendarBatchAction,
  takePendingCalendarDeleteAction,
  takePendingCalendarSelection,
  takePendingEmailDraftAction,
  takePendingFinanceAddAction,
  takePendingFinanceBatchAction,
  takePendingFinanceDeleteAction,
  takePendingFinanceSelection,
  takePendingTodoDeleteAction,
  takePendingTodoSelection,
} from "@/lib/pending-actions";
import {
  getRecentChatHistory,
  logChatMessage,
} from "@/lib/chat-history";
import {
  addTodo,
  completeTodo,
  deleteTodo,
  listTodos,
  searchActiveTodos,
  TodoItem,
} from "@/lib/todos";
import { createEmailDraft } from "@/lib/gmail";
import { ConversationContext, parseAssistantIntent } from "@/lib/assistant-intent";
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
      date: z.number().optional(),
      chat: z.object({
        id: z.number(),
      }),
      from: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
      caption: z.string().optional(),
      reply_to_message: z
        .object({
          message_id: z.number(),
          date: z.number().optional(),
          text: z.string().optional(),
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
        })
        .optional(),

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
        date: z.number().optional(),
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
    "• what do I have to do for today?",
    "• add buy groceries to my to-do list",
    "• I'm done with buy groceries",
    "• remove buy groceries from my list",
    "• draft an email to alex@example.com about project update",
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
    "• /todo — View your active to-do list with checkmark buttons",
    "• /todo today — View today's tasks",
    "• /finance summary — View monthly spending breakdown",
    "• /finance list — View last 10 transactions",
    "• /setcommands — Update Telegram command menu",
    "• /help — Show this help message",
    "",
    "Tap Menu or type / to browse commands.",
  ].join("\n");
}

function formatTodoListMessage(
  todos: TodoItem[],
  title: string
): {
  text: string;
  replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] };
} {
  if (todos.length === 0) {
    return {
      text: `📝 ${title}\n\n🎉 No pending tasks found! You're all caught up.`,
    };
  }

  const lines = [`📝 ${title} (${todos.length}):`, ""];
  const buttons: { text: string; callback_data: string }[][] = [];

  todos.forEach((todo, idx) => {
    const priorityIcon =
      todo.priority === "high" ? "🔴 " : todo.priority === "low" ? "🟢 " : "";
    const dueStr = todo.dueDate ? ` (📅 ${formatCalendarDate(todo.dueDate)})` : "";
    lines.push(`${idx + 1}. ${priorityIcon}${todo.task}${dueStr}`);

    buttons.push([
      {
        text: `✅ Done: ${truncateButtonText(todo.task, 32)}`,
        callback_data: `todo_done:${todo.taskId}`,
      },
    ]);
  });

  return {
    text: lines.join("\n"),
    replyMarkup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
  };
}

function formatEmailDraftPreview(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const parts = [
    "📧 Email Draft Preview:",
    "",
    `👤 To: ${input.to}`,
    `📌 Subject: ${input.subject}`,
  ];
  if (input.cc) parts.push(`👥 Cc: ${input.cc}`);
  if (input.bcc) parts.push(`🔒 Bcc: ${input.bcc}`);
  parts.push("", "📝 Body:", input.body);
  return parts.join("\n");
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

  await recordConfirmedCalendarEvent({
    token: input.token,
    eventId: event.id,
  });

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
    transactionTimestamp: new Date(),
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
      `Date & Time: ${transaction.timestamp} (SGT)`,
    ].join("\n")
  );

  await markUpdateCompleted(input.updateId, "finance_add");

  log("telegram.webhook.completed", {
    updateId: input.updateId,
    action: "finance_add",
    durationMs: Date.now() - input.startedAt,
  });
}

async function handleFinanceBatchCreateCallback(input: {
  callbackId: string;
  action: "finance_batch_yes" | "finance_batch_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  if (input.action === "finance_batch_no") {
    const cancelled = await cancelPendingFinanceBatchAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Transaction logging cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Finance batch logging cancelled."
        : "This finance batch request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "finance_batch_cancelled");
    return;
  }

  const batch = await takePendingFinanceBatchAction(
    input.token,
    input.userId
  );

  if (!batch || !batch.transactions.length) {
    await answerTelegramCallback(
      input.callbackId,
      "This confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This finance batch request has expired or was already handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "finance_batch_confirmation_invalid"
    );
    return;
  }

  await answerTelegramCallback(
    input.callbackId,
    `Logging ${batch.transactions.length} transactions...`
  );

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  const results = await addTransactionsBatch(batch.transactions);

  const summaryLines = batch.transactions.map((t, idx) => {
    return `${idx + 1}. ${t.description} — ${t.amount.toFixed(2)} ${t.currency} (${t.category}, ${t.transactionDate})`;
  });

  const totalAmount = batch.transactions.reduce(
    (acc, curr) => acc + curr.amount,
    0
  );
  const currency = batch.transactions[0]?.currency ?? "SGD";

  await sendTelegramMessage(
    input.chatId,
    [
      `✅ Logged ${results.length} transactions (Total: ${totalAmount.toFixed(2)} ${currency}):`,
      "",
      summaryLines.join("\n"),
    ].join("\n")
  );

  await markUpdateCompleted(input.updateId, "finance_batch_add");

  log("telegram.webhook.completed", {
    updateId: input.updateId,
    action: "finance_batch_add",
    count: results.length,
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

async function handleEmailDraftCallback(input: {
  callbackId: string;
  action: "email_draft_yes" | "email_draft_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}) {
  if (input.action === "email_draft_no") {
    const cancelled = await cancelPendingEmailDraftAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Draft cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Email draft creation cancelled."
        : "This email draft request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "email_draft_cancelled");
    return;
  }

  const pendingAction = await takePendingEmailDraftAction(
    input.token,
    input.userId
  );

  if (!pendingAction) {
    await answerTelegramCallback(
      input.callbackId,
      "This draft confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This email draft request has expired or was already handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "email_draft_confirmation_invalid"
    );
    return;
  }

  await answerTelegramCallback(input.callbackId, "Creating draft in Gmail...");

  try {
    const draft = await createEmailDraft(pendingAction);

    await removeTelegramInlineKeyboard(input.chatId, input.messageId);

    await sendTelegramMessage(
      input.chatId,
      [
        "✉️ Draft created in Gmail!",
        "",
        `To: ${draft.to}`,
        `Subject: ${draft.subject}`,
        `Draft ID: ${draft.draftId}`,
        "",
        `🔗 Open Gmail Drafts: ${draft.gmailUrl}`,
      ].join("\n")
    );

    await markUpdateCompleted(input.updateId, "email_draft_created");
  } catch (error) {
    log("telegram.email_draft.failed", {
      updateId: input.updateId,
      error: errorText(error),
    });

    await removeAndSend(
      input.chatId,
      input.messageId,
      `Failed to create draft in Gmail: ${
        error instanceof Error ? error.message : String(error)
      }`
    );

    await markUpdateFailed(input.updateId, errorText(error));
  }
}

async function handleTodoDoneCallback(input: {
  callbackId: string;
  taskId: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  const result = await completeTodo(input.taskId);

  if (!result.success || !result.todo) {
    await answerTelegramCallback(
      input.callbackId,
      "Task not found or already completed."
    );
    return;
  }

  await answerTelegramCallback(input.callbackId, "✅ Task marked as completed!");

  await sendTelegramMessage(
    input.chatId,
    `✅ Completed: "${result.todo.task}"! 🎉`
  );

  await markUpdateCompleted(input.updateId, "todo_completed_callback");
}

async function handleTodoDeleteCallback(input: {
  callbackId: string;
  action: "todo_del_yes" | "todo_del_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  if (input.action === "todo_del_no") {
    const cancelled = await cancelPendingTodoDeleteAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Task deletion cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Task was kept in your to-do list."
        : "This task deletion request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "todo_delete_cancelled");
    return;
  }

  const pendingAction = await takePendingTodoDeleteAction(
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
      "This task deletion request has expired or was already handled."
    );

    await markUpdateCompleted(input.updateId, "todo_delete_invalid");
    return;
  }

  await answerTelegramCallback(input.callbackId, "Removing task...");

  await deleteTodo(pendingAction.taskId);

  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
    `🗑️ Removed "${pendingAction.task}" from your to-do list.`
  );

  await markUpdateCompleted(input.updateId, "todo_delete_confirmed");
}

async function handleTodoSelectionCallback(input: {
  callbackId: string;
  selectionToken: string;
  selectedIndex: number;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}) {
  const pending = await takePendingTodoSelection(
    input.selectionToken,
    input.userId
  );

  if (!pending) {
    await answerTelegramCallback(
      input.callbackId,
      "This selection has expired or was already used."
    );
    await removeAndSend(
      input.chatId,
      input.messageId,
      "This task selection has expired or was already used."
    );
    await markUpdateCompleted(input.updateId, "todo_selection_invalid");
    return;
  }

  const selectedTodo = pending.todos[input.selectedIndex];
  if (!selectedTodo) {
    await answerTelegramCallback(input.callbackId, "Selected task not found.");
    return;
  }

  const confirmToken = await savePendingTodoDeleteAction({
    userId: input.userId,
    payload: {
      taskId: selectedTodo.taskId,
      task: selectedTodo.task,
    },
  });

  await answerTelegramCallback(input.callbackId);
  await removeTelegramInlineKeyboard(input.chatId, input.messageId);

  await sendTelegramMessage(
    input.chatId,
    [
      "Are you sure you want to remove this task?",
      "",
      `• ${selectedTodo.task}`,
    ].join("\n"),
    {
      inline_keyboard: [
        [
          {
            text: "🗑️ Yes, remove",
            callback_data: `todo_del_yes:${confirmToken}`,
          },
          {
            text: "❌ No, keep",
            callback_data: `todo_del_no:${confirmToken}`,
          },
        ],
      ],
    }
  );

  await markUpdateCompleted(input.updateId, "todo_delete_confirmation_prompted");
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

  if (action === "finance_batch_yes" || action === "finance_batch_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleFinanceBatchCreateCallback({
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

  if (action === "email_draft_yes" || action === "email_draft_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleEmailDraftCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  if (action === "todo_done") {
    const taskId = parts[1];

    if (!taskId) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleTodoDoneCallback({
      ...input,
      taskId,
    });

    return;
  }

  if (action === "todo_del_yes" || action === "todo_del_no") {
    const token = parts[1];

    if (!token) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    await handleTodoDeleteCallback({
      ...input,
      action,
      token,
    });

    return;
  }

  if (action === "todo_del_select") {
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

    await handleTodoSelectionCallback({
      ...input,
      selectionToken,
      selectedIndex,
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

async function processAssistantImage(input: {
  chatId: number;
  userId: number;
  fileId: string;
  instruction: string;
  updateId: number;
}): Promise<boolean> {
  const { chatId, userId, fileId, instruction, updateId } = input;
  await sendTelegramMessage(chatId, "Reading your image...");

  const downloadedImage = await downloadTelegramPhoto(fileId);

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
      `${imageIntent.message}\n\nPlease send a clearer image or add more detail in your request.`
    );

    await markUpdateCompleted(updateId, "image_unknown");

    return true;
  }

  if (imageIntent.action === "finance_from_image") {
    const token = await savePendingFinanceAddAction({
      userId,
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

    return true;
  }

  if (imageIntent.action === "finance_batch_from_image") {
    if (!imageIntent.transactions.length) {
      await sendTelegramMessage(
        chatId,
        "I could not find any clear transactions in that image."
      );

      await markUpdateCompleted(updateId, "image_finance_empty");

      return true;
    }

    if (imageIntent.transactions.length === 1) {
      const single = imageIntent.transactions[0];
      const token = await savePendingFinanceAddAction({
        userId,
        payload: {
          type: single.type,
          amount: single.amount,
          currency: single.currency,
          category: single.category,
          description: single.description,
          transactionDate: single.transactionDate,
        },
      });

      await sendTelegramMessage(
        chatId,
        [
          "I found this transaction in the image. Log it?",
          "",
          `Type: ${single.type}`,
          `Amount: ${single.amount.toFixed(2)} ${single.currency}`,
          `Category: ${single.category}`,
          `Description: ${single.description}`,
          `Date: ${single.transactionDate}`,
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

      return true;
    }

    const token = await savePendingFinanceBatchAction({
      userId,
      payload: {
        transactions: imageIntent.transactions,
      },
    });

    const previews = imageIntent.transactions.map((t, idx) => {
      return `${idx + 1}. ${t.description} — ${t.amount.toFixed(2)} ${t.currency} (${t.category}, ${t.transactionDate})`;
    });

    const total = imageIntent.transactions.reduce(
      (acc, curr) => acc + curr.amount,
      0
    );
    const curr = imageIntent.transactions[0]?.currency ?? "SGD";

    await sendTelegramMessage(
      chatId,
      [
        `I found ${imageIntent.transactions.length} transactions in the image (Total: ${total.toFixed(2)} ${curr}):`,
        "",
        previews.join("\n"),
        "",
        `Log all ${imageIntent.transactions.length} transactions?`,
      ].join("\n"),
      {
        inline_keyboard: [
          [
            {
              text: `✅ Yes, log all (${imageIntent.transactions.length})`,
              callback_data: `finance_batch_yes:${token}`,
            },
            {
              text: "❌ No, cancel",
              callback_data: `finance_batch_no:${token}`,
            },
          ],
        ],
      }
    );

    await markUpdateCompleted(updateId, "image_finance_batch_pending");

    return true;
  }

  if (imageIntent.action === "calendar_from_image") {
    if (!imageIntent.events.length) {
      await sendTelegramMessage(
        chatId,
        "I could not find any clear calendar events in that image."
      );

      await markUpdateCompleted(updateId, "image_calendar_empty");

      return true;
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
        userId,
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

      return true;
    }

    // Multiple events: Batch Review
    const token = await savePendingCalendarBatchAction({
      userId,
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

    return true;
  }

  return false;
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
        await savePendingImageAction({
          userId: message.from.id,
          payload: {
            fileId: largestPhoto.file_id,
            sentAt: new Date().toISOString(),
          },
        });

        const promptText = [
          "I received your image! 📸",
          "",
          "What would you like me to do with it?",
          "• “Log these as an expense”",
          "• “Add these dates to my personal calendar”",
          "• “Add these dates to my work calendar”",
        ].join("\n");

        await sendTelegramMessage(chatId, promptText);

        logChatMessage({
          messageId: message.message_id,
          userId: message.from.id,
          role: "user",
          text: "[Image uploaded]",
          photoFileId: largestPhoto.file_id,
          actionType: "image_upload",
        }).catch(() => {});

        logChatMessage({
          userId: message.from.id,
          role: "assistant",
          text: promptText,
          actionType: "pending_image_instruction",
        }).catch(() => {});

        await markUpdateCompleted(updateId, "image_pending_instruction");

        return Response.json({ ok: true });
      }

      const handled = await processAssistantImage({
        chatId,
        userId: message.from.id,
        fileId: largestPhoto.file_id,
        instruction,
        updateId,
      });

      if (handled) {
        logChatMessage({
          messageId: message.message_id,
          userId: message.from.id,
          role: "user",
          text: instruction,
          photoFileId: largestPhoto.file_id,
          actionType: "image_with_caption",
        }).catch(() => {});

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
      let followUpImageFileId: string | undefined;
      let pendingImageToken: string | undefined;

      if (message.reply_to_message?.photo?.length) {
        const replyPhotos = message.reply_to_message.photo;
        followUpImageFileId = replyPhotos[replyPhotos.length - 1].file_id;
      } else {
        const pendingImage = await getLatestPendingImage(message.from.id);
        if (pendingImage) {
          const isImageReply =
            message.reply_to_message?.text?.includes("received your image") ?? false;
          const isInstruction =
            /log\s+(this|these)|expense|receipt|screenshot|dates?|calendar|add\s+(this|these)|record|spend/i.test(
              text
            );
          if (isImageReply || isInstruction) {
            followUpImageFileId = pendingImage.payload.fileId;
            pendingImageToken = pendingImage.token;
          }
        }
      }

      if (followUpImageFileId) {
        if (pendingImageToken) {
          await consumePendingImage(pendingImageToken);
        }

        const handled = await processAssistantImage({
          chatId,
          userId: message.from.id,
          fileId: followUpImageFileId,
          instruction: text,
          updateId,
        });

        if (handled) {
          logChatMessage({
            messageId: message.message_id,
            userId: message.from.id,
            role: "user",
            text,
            actionType: "image_followup",
          }).catch(() => {});

          return Response.json({ ok: true });
        }
      }

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
        { command: "todo", description: "View active to-do list" },
        { command: "todotoday", description: "View today's to-do list" },
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

    if (text === "/todo" || text === "/todos" || text === "/tasks") {
      const todos = await listTodos({ status: "active" });
      const formatted = formatTodoListMessage(todos, "Active To-Do List");
      await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
      await markUpdateCompleted(updateId, "todo_list_command");
      return Response.json({ ok: true });
    }

    if (text === "/todo today" || text === "/todotoday") {
      const todos = await listTodos({ date: "today", status: "active" });
      const formatted = formatTodoListMessage(todos, "Today's To-Do List");
      await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
      await markUpdateCompleted(updateId, "todo_today_command");
      return Response.json({ ok: true });
    }

    if (text.startsWith("/todo add ")) {
      const taskText = text.replace("/todo add ", "").trim();
      if (!taskText) {
        await sendTelegramMessage(chatId, "Please specify a task: /todo add <task>");
        await markUpdateCompleted(updateId, "todo_add_empty");
        return Response.json({ ok: true });
      }

      const todo = await addTodo({ task: taskText });
      await sendTelegramMessage(
        chatId,
        `✅ Added to your to-do list:\n• ${todo.task}`,
        {
          inline_keyboard: [
            [
              {
                text: "✅ Mark Done",
                callback_data: `todo_done:${todo.taskId}`,
              },
            ],
          ],
        }
      );
      await markUpdateCompleted(updateId, "todo_add_command");
      return Response.json({ ok: true });
    }

    if (text.startsWith("/todo done ")) {
      const query = text.replace("/todo done ", "").trim();
      const matches = await searchActiveTodos(query);
      if (matches.length === 0) {
        await sendTelegramMessage(chatId, `No active tasks matching "${query}".`);
      } else if (matches.length === 1) {
        await completeTodo(matches[0].taskId);
        await sendTelegramMessage(chatId, `✅ Completed: "${matches[0].task}"! 🎉`);
      } else {
        await sendTelegramMessage(
          chatId,
          "Multiple tasks match. Tap which one you finished:",
          {
            inline_keyboard: matches.map((m) => [
              {
                text: `✅ ${truncateButtonText(m.task, 40)}`,
                callback_data: `todo_done:${m.taskId}`,
              },
            ]),
          }
        );
      }
      await markUpdateCompleted(updateId, "todo_done_command");
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
      text.startsWith("/finance_summary ") ||
      text === "/financesummary" ||
      text.startsWith("/financesummary ")
    ) {
      const subArg = text
        .replace("/finance_summary", "")
        .replace("/financesummary", "")
        .replace("/finance summary", "")
        .trim()
        .toLowerCase();

      let period: "today" | "week" | "month" | "all" = "today";
      if (subArg === "month") period = "month";
      else if (subArg === "week") period = "week";
      else if (subArg === "all") period = "all";
      else if (subArg === "today") period = "today";

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

      const transaction = await addTransaction({
        ...input,
        transactionTimestamp: message.date ? new Date(message.date * 1000) : new Date(),
      });

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

    const messageDateObj = message.date ? new Date(message.date * 1000) : new Date();

    const recentChatHistory = await getRecentChatHistory(message.from.id, 8);

    const userCalendarContext = await getLatestUserCalendarContext(
      message.from.id
    );
    const conversationContext: ConversationContext = {
      messageTime: messageDateObj,
      repliedMessageText: message.reply_to_message?.text,
      activePendingCalendar: userCalendarContext.activePending?.payload,
      recentCalendarEvent: userCalendarContext.recentConfirmed,
      recentChatHistory,
    };

    logChatMessage({
      messageId: message.message_id,
      userId: message.from.id,
      role: "user",
      text,
    }).catch(() => {});

    const intentStartAt = Date.now();
    const intent = await parseAssistantIntent(text, conversationContext);

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
        explicitDate: intent.explicitDate,
        transactionTimestamp: messageDateObj,
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
          `Date & Time: ${transaction.timestamp} (SGT)`,
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
      if (userCalendarContext.activePending) {
        await cancelActivePendingCalendarAction(message.from.id);
      }

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

    if (intent.action === "todo_add") {
      const todo = await addTodo({
        task: intent.task,
        dueDate: intent.dueDate,
        priority: intent.priority,
      });

      const dueStr = todo.dueDate
        ? `\n📅 Due: ${formatCalendarDate(todo.dueDate)}`
        : "";

      await sendTelegramMessage(
        chatId,
        `✅ Added to your to-do list:\n• ${todo.task}${dueStr}`,
        {
          inline_keyboard: [
            [
              {
                text: "✅ Mark Done",
                callback_data: `todo_done:${todo.taskId}`,
              },
            ],
          ],
        }
      );

      await markUpdateCompleted(updateId, "todo_add_natural_language");
      return Response.json({ ok: true });
    }

    if (intent.action === "todo_view") {
      const isToday = intent.timeframe === "today";
      const todos = await listTodos({
        date: isToday ? "today" : undefined,
        status: "active",
      });

      const title = isToday ? "Today's To-Do List" : "Active To-Do List";
      const formatted = formatTodoListMessage(todos, title);
      await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);

      await markUpdateCompleted(updateId, "todo_view_natural_language");
      return Response.json({ ok: true });
    }

    if (intent.action === "todo_complete") {
      const matches = await searchActiveTodos(intent.query);
      if (matches.length === 0) {
        await sendTelegramMessage(
          chatId,
          `I couldn't find any active tasks matching “${intent.query}”.`
        );
      } else if (matches.length === 1) {
        await completeTodo(matches[0].taskId);
        await sendTelegramMessage(
          chatId,
          `✅ Marked as done: “${matches[0].task}”! 🎉`
        );
      } else {
        await sendTelegramMessage(
          chatId,
          `Found ${matches.length} tasks matching “${intent.query}”. Tap which one you finished:`,
          {
            inline_keyboard: matches.map((m) => [
              {
                text: `✅ ${truncateButtonText(m.task, 40)}`,
                callback_data: `todo_done:${m.taskId}`,
              },
            ]),
          }
        );
      }

      await markUpdateCompleted(updateId, "todo_complete_natural_language");
      return Response.json({ ok: true });
    }

    if (intent.action === "todo_delete_search") {
      const matches = await searchActiveTodos(intent.query);
      if (matches.length === 0) {
        await sendTelegramMessage(
          chatId,
          `I couldn't find any active tasks matching “${intent.query}” to remove.`
        );
        await markUpdateCompleted(updateId, "todo_delete_search_empty");
        return Response.json({ ok: true });
      }

      if (matches.length === 1) {
        const match = matches[0];
        const token = await savePendingTodoDeleteAction({
          userId: message.from.id,
          payload: {
            taskId: match.taskId,
            task: match.task,
          },
        });

        await sendTelegramMessage(
          chatId,
          `Remove this task from your to-do list?\n\n• ${match.task}`,
          {
            inline_keyboard: [
              [
                {
                  text: "🗑️ Yes, remove",
                  callback_data: `todo_del_yes:${token}`,
                },
                {
                  text: "❌ No, keep",
                  callback_data: `todo_del_no:${token}`,
                },
              ],
            ],
          }
        );

        await markUpdateCompleted(updateId, "todo_delete_prompt");
        return Response.json({ ok: true });
      }

      const token = await savePendingTodoSelection({
        userId: message.from.id,
        payload: {
          todos: matches.map((m) => ({ taskId: m.taskId, task: m.task })),
        },
      });

      await sendTelegramMessage(
        chatId,
        `Found ${matches.length} tasks matching “${intent.query}”. Which one would you like to remove?`,
        {
          inline_keyboard: matches.map((m, idx) => [
            {
              text: `🗑️ ${truncateButtonText(m.task, 40)}`,
              callback_data: `todo_del_select:${token}:${idx}`,
            },
          ]),
        }
      );

      await markUpdateCompleted(updateId, "todo_delete_selection_prompt");
      return Response.json({ ok: true });
    }

    if (intent.action === "email_draft") {
      const token = await savePendingEmailDraftAction({
        userId: message.from.id,
        payload: {
          to: intent.to,
          subject: intent.subject,
          body: intent.body,
          cc: intent.cc,
          bcc: intent.bcc,
        },
      });

      await sendTelegramMessage(
        chatId,
        [
          "Create this draft in your Gmail (evanyap7@gmail.com)?",
          "",
          formatEmailDraftPreview({
            to: intent.to,
            subject: intent.subject,
            body: intent.body,
            cc: intent.cc,
            bcc: intent.bcc,
          }),
        ].join("\n"),
        {
          inline_keyboard: [
            [
              {
                text: "📝 Create Draft in Gmail",
                callback_data: `email_draft_yes:${token}`,
              },
              {
                text: "❌ Cancel",
                callback_data: `email_draft_no:${token}`,
              },
            ],
          ],
        }
      );

      await markUpdateCompleted(updateId, "email_draft_prompt");
      return Response.json({ ok: true });
    }

    if (intent.action === "calendar_move") {
      try {
        const moveRes = await moveCalendarEvent({
          fromCalendar: intent.fromCalendar,
          toCalendar: intent.toCalendar,
          title: intent.title,
          eventId: intent.eventId,
          allDay: intent.allDay,
          start: intent.start,
          end: intent.end,
          date: intent.date,
        });

        const fromBadge =
          intent.fromCalendar === "work" ? "💼 Work" : "🏠 Personal";
        const toBadge =
          intent.toCalendar === "work" ? "💼 Work" : "🏠 Personal";

        const timingLine = moveRes.allDay
          ? `Date: ${formatCalendarDate(moveRes.start)} (All day)`
          : `Start: ${formatSingaporeDateTime(moveRes.start)}\nEnd: ${formatSingaporeDateTime(moveRes.end ?? "")}`;

        await sendTelegramMessage(
          chatId,
          [
            `✅ Moved event from ${fromBadge} to ${toBadge}!`,
            "",
            `Title: ${moveRes.title}`,
            timingLine,
            moveRes.htmlLink ? `Link: ${moveRes.htmlLink}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );

        await markUpdateCompleted(updateId, "calendar_move");
        return Response.json({ ok: true });
      } catch (moveError) {
        log("telegram.calendar_move.failed", {
          updateId,
          error: errorText(moveError),
        });

        await sendTelegramMessage(
          chatId,
          `Sorry, I couldn't move "${intent.title}" to ${intent.toCalendar}: ${
            moveError instanceof Error ? moveError.message : "Unknown error"
          }`
        );

        await markUpdateFailed(updateId, errorText(moveError));
        return Response.json({ ok: true });
      }
    }

    if (intent.action === "unknown") {
      const replyMsg = `${intent.message}\n\nTry /help for examples.`;
      await sendTelegramMessage(chatId, replyMsg);

      logChatMessage({
        userId: message.from.id,
        role: "assistant",
        text: replyMsg,
        actionType: "unknown",
      }).catch(() => {});

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