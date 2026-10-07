import {
  answerTelegramCallback,
  editTelegramMessage,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
} from "../telegram";
import { defaultRegistry } from "../handlers/dispatcher";
import {
  getCompactDashboardMarkup,
  getCompactDashboardText,
  getSubmenuMarkup,
} from "./menu-builder";
import {
  cancelPendingCalendarDeleteAction,
  cancelPendingFinanceDeleteAction,
  cancelPendingTodoDeleteAction,
  savePendingCalendarDeleteAction,
  savePendingFinanceDeleteAction,
  savePendingTodoDeleteAction,
  takePendingCalendarDeleteAction,
  takePendingCalendarSelection,
  takePendingFinanceDeleteAction,
  takePendingFinanceSelection,
  takePendingTodoDeleteAction,
  takePendingTodoSelection,
} from "../pending-actions";
import {
  markUpdateCompleted,
  searchActiveTransactions,
  softDeleteTransaction,
  updateTransaction,
} from "../finance";
import { formatFinanceTransaction } from "../handlers/finance-handler";
import {
  deleteCalendarEvent,
  getUpcomingSchedule,
} from "../calendar";
import { formatCalendarEvent } from "../handlers/calendar-handler";
import {
  formatScheduleAgendaView,
  formatSchedulePureTableView,
  ScheduleTimeframe,
} from "../calendar-format";
import {
  completeTodo,
  deleteTodo,
  muteTodoReminder,
  snoozeTodoReminder,
} from "../todos";
import {
  handleWorkoutViewAction,
} from "../workout/workout-handler";
import { setupWorkoutDashboardSheet } from "../workout/workout-dashboard";
import { startPH3Workout } from "../workout/workout-session";
import { buildUndoInlineKeyboard, registerUndoAction } from "../undo";
import { dispatchCommand } from "./command-router";

export interface CallbackDispatchInput {
  callbackId: string;
  callbackData: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}

export async function dispatchCallback(input: CallbackDispatchInput): Promise<void> {
  const parts = input.callbackData.split(":");
  const action = parts[0];

  // 1. Check registry callbacks (undo, gym_loc, habits, recurring, iou, draft, etc.)
  const handledByRegistry = await defaultRegistry.dispatchCallback({
    callbackId: input.callbackId,
    callbackData: input.callbackData,
    action,
    parts,
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.messageId,
    updateId: input.updateId,
    startedAt: input.startedAt,
  });
  if (handledByRegistry) {
    return;
  }

  // 2. Menu navigation
  if (action === "menu") {
    const subAction = parts[1] || "home";

    if (subAction === "home") {
      await answerTelegramCallback(input.callbackId);
      await editTelegramMessage(
        input.chatId,
        input.messageId,
        getCompactDashboardText(),
        getCompactDashboardMarkup()
      );
      await markUpdateCompleted(input.updateId, "menu_home");
      return;
    }

    if (
      subAction === "calendar" ||
      subAction === "finance" ||
      subAction === "workout" ||
      subAction === "tasks"
    ) {
      await answerTelegramCallback(input.callbackId);
      const sub = getSubmenuMarkup(subAction);
      await editTelegramMessage(input.chatId, input.messageId, sub.text, sub.markup);
      await markUpdateCompleted(input.updateId, `menu_${subAction}`);
      return;
    }

    if (subAction === "workout_start") {
      await answerTelegramCallback(input.callbackId);
      await startPH3Workout({ chatId: input.chatId });
      await markUpdateCompleted(input.updateId, "menu_workout_start");
      return;
    }

    if (subAction === "workout_stats") {
      await answerTelegramCallback(input.callbackId);
      await handleWorkoutViewAction({ chatId: input.chatId });
      await markUpdateCompleted(input.updateId, "menu_workout_stats");
      return;
    }

    if (subAction === "workout_setup_sheet") {
      await answerTelegramCallback(input.callbackId, "Setting up sheets...");
      const res = await setupWorkoutDashboardSheet();
      await sendTelegramMessage(input.chatId, `✅ ${res.message}`);
      await markUpdateCompleted(input.updateId, "menu_workout_setup");
      return;
    }

    const menuCommandMap: Record<string, string> = {
      agenda: "/agenda",
      cal_week: "/calendar week",
      freeslots: "/freeslots",
      reminders: "/reminders",
      finance_summary: "/finance_summary",
      finance_list: "/finance_list",
      budget: "/budget",
      sync: "/sync",
      todos: "/todo",
      todos_today: "/todotoday",
      habits: "/habits",
      recurring: "/recurring",
      owed: "/owed",
      export: "/export",
      inbox: "/inbox",
    };

    if (menuCommandMap[subAction]) {
      await answerTelegramCallback(input.callbackId);
      await dispatchCommand({
        chatId: input.chatId,
        userId: input.userId,
        updateId: input.updateId,
        text: menuCommandMap[subAction],
      });
      await markUpdateCompleted(input.updateId, `menu_${subAction}`);
      return;
    }

    // Other menu actions
    await answerTelegramCallback(input.callbackId);
    await markUpdateCompleted(input.updateId, `menu_${subAction}`);
    return;
  }

  // 3. To-do Done Callback
  if (action === "todo_done") {
    const taskId = parts[1];
    if (!taskId) {
      await answerTelegramCallback(input.callbackId, "Invalid task ID.");
      return;
    }
    const res = await completeTodo(taskId);
    if (!res.success) {
      await answerTelegramCallback(input.callbackId, "Task not found or already completed.");
      return;
    }

    const undoToken = await registerUndoAction(input.userId, {
      type: "todo_completed",
      description: res.todo?.task || "task",
      data: { taskId },
    });

    await answerTelegramCallback(input.callbackId, "Task completed! 🎉");
    await editTelegramMessage(
      input.chatId,
      input.messageId,
      `✅ *Completed:* "${res.todo?.task}"! 🎉`,
      buildUndoInlineKeyboard(undoToken)
    );
    await markUpdateCompleted(input.updateId, "todo_done_callback");
    return;
  }

  // 4. To-do Mute
  if (action === "todo_mute") {
    const taskId = parts[1];
    if (!taskId) {
      await answerTelegramCallback(input.callbackId, "Invalid task ID.");
      return;
    }
    await muteTodoReminder(taskId);
    await answerTelegramCallback(input.callbackId, "🔕 Reminders paused.");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    await sendTelegramMessage(
      input.chatId,
      "🔕 Recurring reminders paused for this task. It remains in your active to-do list."
    );
    await markUpdateCompleted(input.updateId, "todo_mute_callback");
    return;
  }

  // 5. To-do Snooze
  if (action === "todo_snooze") {
    const duration = parts[1] as "1h" | "tonight" | "tomorrow";
    const taskId = parts[2];
    if (!taskId || !duration) {
      await answerTelegramCallback(input.callbackId, "Invalid request.");
      return;
    }
    const res = await snoozeTodoReminder(taskId, duration);
    if (!res.success) {
      await answerTelegramCallback(input.callbackId, "Task not found or already completed.");
      return;
    }
    await answerTelegramCallback(input.callbackId, `⏰ Snoozed for ${res.description}!`);
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    await sendTelegramMessage(input.chatId, `⏰ Reminder snoozed until ${res.description}.`);
    await markUpdateCompleted(input.updateId, "todo_snooze_callback");
    return;
  }

  // 6. To-do Delete
  if (action === "todo_del_yes" || action === "todo_del_no") {
    const token = parts[1];
    if (action === "todo_del_no") {
      await cancelPendingTodoDeleteAction(token, input.userId);
      await answerTelegramCallback(input.callbackId, "Deletion cancelled.");
      await removeTelegramInlineKeyboard(input.chatId, input.messageId);
      await sendTelegramMessage(input.chatId, "Task was kept.");
      return;
    }
    const payload = await takePendingTodoDeleteAction(token, input.userId);
    if (!payload) {
      await answerTelegramCallback(input.callbackId, "Request expired.");
      return;
    }
    await deleteTodo(payload.taskId);
    await answerTelegramCallback(input.callbackId, "Task removed.");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    await sendTelegramMessage(input.chatId, `🗑️ Task "${payload.task}" removed.`);
    return;
  }

  // 7. Finance Delete
  if (action === "finance_delete_yes" || action === "finance_delete_no") {
    const token = parts[1];
    if (action === "finance_delete_no") {
      await cancelPendingFinanceDeleteAction(token, input.userId);
      await answerTelegramCallback(input.callbackId, "Deletion cancelled.");
      await removeTelegramInlineKeyboard(input.chatId, input.messageId);
      await sendTelegramMessage(input.chatId, "Transaction was kept.");
      return;
    }
    const payload = await takePendingFinanceDeleteAction(token, input.userId);
    if (!payload) {
      await answerTelegramCallback(input.callbackId, "Request expired.");
      return;
    }
    const deleted = await softDeleteTransaction(payload.transactionId);
    await answerTelegramCallback(input.callbackId, "Deleted.");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    await sendTelegramMessage(
      input.chatId,
      deleted
        ? `🗑️ Deleted transaction: ${formatFinanceTransaction(deleted)}`
        : "Transaction already removed."
    );
    return;
  }

  // 8. Calendar Delete
  if (action === "calendar_delete_yes" || action === "calendar_delete_no") {
    const token = parts[1];
    if (action === "calendar_delete_no") {
      await cancelPendingCalendarDeleteAction(token, input.userId);
      await answerTelegramCallback(input.callbackId, "Deletion cancelled.");
      await removeTelegramInlineKeyboard(input.chatId, input.messageId);
      await sendTelegramMessage(input.chatId, "Event was kept.");
      return;
    }
    const payload = await takePendingCalendarDeleteAction(token, input.userId);
    if (!payload) {
      await answerTelegramCallback(input.callbackId, "Request expired.");
      return;
    }
    await deleteCalendarEvent({
      calendarName: payload.calendarName,
      eventId: payload.eventId,
    });
    await answerTelegramCallback(input.callbackId, "Event deleted.");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    await sendTelegramMessage(input.chatId, `🗑️ Calendar event deleted.`);
    return;
  }

  // 8.5 Disambiguation Select Callbacks
  if (action === "finance_select") {
    const selectionToken = parts[1];
    const selectedIndex = Number(parts[2]);
    if (!selectionToken || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    const selection = await takePendingFinanceSelection(selectionToken, input.userId);
    const transactionId = selection?.transactionIds[selectedIndex];
    if (!transactionId) {
      await answerTelegramCallback(input.callbackId, "This selection has expired.");
      return;
    }

    const matches = await searchActiveTransactions(transactionId);
    const transaction = matches.find((c) => c.transactionId === transactionId);
    if (!transaction) {
      await answerTelegramCallback(input.callbackId, "Transaction not found or already deleted.");
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
            { text: "🗑️ Yes, delete", callback_data: `finance_delete_yes:${confirmationToken}` },
            { text: "❌ No, keep it", callback_data: `finance_delete_no:${confirmationToken}` },
          ],
        ],
      }
    );
    await markUpdateCompleted(input.updateId, "finance_selection_confirmed");
    return;
  }

  if (action === "calendar_select") {
    const selectionToken = parts[1];
    const selectedIndex = Number(parts[2]);
    if (!selectionToken || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    const selection = await takePendingCalendarSelection(selectionToken, input.userId);
    const event = selection?.events[selectedIndex];
    if (!selection || !event) {
      await answerTelegramCallback(input.callbackId, "This selection has expired.");
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
            { text: "🗑️ Yes, delete", callback_data: `calendar_delete_yes:${confirmationToken}` },
            { text: "❌ No, keep it", callback_data: `calendar_delete_no:${confirmationToken}` },
          ],
        ],
      }
    );
    await markUpdateCompleted(input.updateId, "calendar_selection_confirmed");
    return;
  }

  if (action === "todo_del_select") {
    const selectionToken = parts[1];
    const selectedIndex = Number(parts[2]);
    if (!selectionToken || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      await answerTelegramCallback(input.callbackId, "This action is invalid.");
      return;
    }

    const selection = await takePendingTodoSelection(selectionToken, input.userId);
    const todo = selection?.todos[selectedIndex];
    if (!selection || !todo) {
      await answerTelegramCallback(input.callbackId, "This selection has expired.");
      return;
    }

    const confirmationToken = await savePendingTodoDeleteAction({
      userId: input.userId,
      payload: {
        taskId: todo.taskId,
        task: todo.task,
      },
    });

    await answerTelegramCallback(input.callbackId, "Task selected.");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    await sendTelegramMessage(
      input.chatId,
      `Remove this task from your to-do list?\n\n• ${todo.task}`,
      {
        inline_keyboard: [
          [
            { text: "🗑️ Yes, remove", callback_data: `todo_del_yes:${confirmationToken}` },
            { text: "❌ No, keep", callback_data: `todo_del_no:${confirmationToken}` },
          ],
        ],
      }
    );
    await markUpdateCompleted(input.updateId, "todo_selection_confirmed");
    return;
  }

  // 9. Calendar Mode Switch (Table vs Agenda)
  if (action === "cal_mode") {
    const rawTarget = parts[1] || "table";
    const timeframe = (parts[2] || "week") as ScheduleTimeframe;
    const calendarName = (parts[3] || "all") as "personal" | "work" | "all";

    const isTable = rawTarget === "table" || rawTarget === "refresh_table";
    const isRefresh = rawTarget.startsWith("refresh");

    await answerTelegramCallback(
      input.callbackId,
      isRefresh ? "🔄 Schedule refreshed" : isTable ? "📊 Switched to Table" : "📋 Switched to Agenda"
    ).catch(() => {});

    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const events = await getUpcomingSchedule({
      calendarName,
      timeMin: now.toISOString(),
      timeMax: weekEnd.toISOString(),
      maxResults: 40,
    });

    const formatted = isTable
      ? formatSchedulePureTableView(events, { timeframe, title: "Upcoming Schedule", calendarName })
      : formatScheduleAgendaView(events, { timeframe, title: "Upcoming Schedule", calendarName });

    await editTelegramMessage(input.chatId, input.messageId, formatted.text, formatted.replyMarkup);
    return;
  }

  // 10. Apple Wallet Callbacks
  if (action === "wallet_undo") {
    const transactionId = parts[1];
    if (transactionId) {
      const transaction = await softDeleteTransaction(transactionId);
      await answerTelegramCallback(input.callbackId, "Expense removed!");
      if (transaction) {
        await editTelegramMessage(
          input.chatId,
          input.messageId,
          `🗑️ *Apple Pay Expense Deleted*\n\n• ${transaction.description}: ${transaction.currency} ${transaction.amount}`
        );
      }
    }
    return;
  }

  if (action === "wallet_cat") {
    const transactionId = parts[1];
    const categories = ["Dining", "Transport", "Groceries", "Shopping", "Entertainment", "General"];
    await answerTelegramCallback(input.callbackId);
    await editTelegramMessage(
      input.chatId,
      input.messageId,
      "💳 Select category:",
      {
        inline_keyboard: categories.map((c) => [
          { text: c, callback_data: `wallet_setcat:${transactionId}:${c}` },
        ]),
      }
    );
    return;
  }

  if (action === "wallet_setcat") {
    const transactionId = parts[1];
    const category = parts[2];
    if (transactionId && category) {
      await updateTransaction(transactionId, { category });
      await answerTelegramCallback(input.callbackId, `Category updated: ${category}!`);
      await editTelegramMessage(
        input.chatId,
        input.messageId,
        `✅ Updated category to *${category}*!`
      );
    }
    return;
  }

  if (action === "wallet_cancel") {
    await answerTelegramCallback(input.callbackId, "Cancelled.");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    return;
  }

  // 11. Legacy action callbacks (auto-handled)
  if (
    action.startsWith("calendar_yes") ||
    action.startsWith("calendar_batch_yes") ||
    action.startsWith("finance_add_yes") ||
    action.startsWith("finance_batch_yes")
  ) {
    await answerTelegramCallback(input.callbackId, "✅ Action was already processed automatically!");
    await removeTelegramInlineKeyboard(input.chatId, input.messageId);
    return;
  }

  await answerTelegramCallback(input.callbackId, "Unknown or expired action.");
}
