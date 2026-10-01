import {
  BOT_COMMANDS,
  getCompactDashboardMarkup,
  getCompactDashboardText,
} from "./menu-builder";
import {
  sendTelegramChatAction,
  sendTelegramMessage,
  setTelegramBotCommands,
} from "../telegram";
import {
  checkAndSendEventReminders,
  getUpcomingSchedule,
} from "../calendar";
import {
  formatCalendarDate,
  formatScheduleAgendaView,
  handleCalendarFreeSlotsAction,
} from "../handlers/calendar-handler";
import {
  checkAndSendTodoReminders,
  completeTodo,
  listTodos,
  searchActiveTodos,
} from "../todos";
import {
  formatTodoListMessage,
  handleTodoAddAction,
} from "../handlers/todo-handler";
import { formatBudgetSummary } from "../budget";
import { tryHandleBudgetSetCommand } from "../handlers/budget-handler";
import { getFinanceSummary } from "../finance";
import {
  formatFinanceSummary,
  handleFinanceSummaryAction,
} from "../handlers/finance-handler";
import {
  handleIOUSummaryAction,
  handleOwedCommand,
  handleSplitCommand,
} from "../handlers/split-handler";
import {
  buildRecurringListMessage,
  handleRecurringCommand,
} from "../handlers/recurring-handler";
import {
  createHabit,
  formatHabitsSummary,
  listHabits,
  logHabitDone,
} from "../habits";
import { checkAndSendLeaveNowAlerts } from "../travel";
import { triageUnreadInbox } from "../inbox-triage";
import {
  handleRecallCommand,
  handleRememberCommand,
} from "../handlers/memory-handler";
import { generateMonthlyCsvExport } from "../export";
import { syncPayLahTransactions } from "../paylah-sync";
import {
  handleWorkoutStartAction,
  handleWorkoutViewAction,
} from "../workout/workout-handler";
import { setupWorkoutDashboardSheet } from "../workout/workout-dashboard";
import { executeLatestUndo } from "../undo";

export interface CommandContext {
  chatId: number;
  userId: number;
  updateId: number;
  text: string;
}

export async function dispatchCommand(
  ctx: CommandContext
): Promise<{ handled: boolean; completionStatus?: string }> {
  const { chatId, userId, updateId, text } = ctx;
  const lowerText = text.toLowerCase().trim();

  // Menu / Dashboard
  if (
    text === "/start" ||
    text === "/help" ||
    text === "/menu" ||
    lowerText === "menu" ||
    lowerText === "functions" ||
    lowerText === "dashboard" ||
    lowerText === "buttons"
  ) {
    await sendTelegramMessage(chatId, getCompactDashboardText(), getCompactDashboardMarkup());
    return { handled: true, completionStatus: "menu_dashboard" };
  }

  // Set Commands
  if (text === "/setcommands") {
    await setTelegramBotCommands(BOT_COMMANDS);
    await sendTelegramMessage(
      chatId,
      "✅ Telegram bot command menu updated! Tap Menu or type `/` to see quick commands.",
      getCompactDashboardMarkup()
    );
    return { handled: true, completionStatus: "set_commands" };
  }

  // Reminders check
  if (text === "/reminders" || lowerText === "check reminders") {
    const [eventResult, todoResult, leaveNowSent] = await Promise.all([
      checkAndSendEventReminders(),
      checkAndSendTodoReminders(),
      checkAndSendLeaveNowAlerts(chatId),
    ]);

    const lines: string[] = ["🔔 *Reminders Status*:"];
    if (eventResult.remindersSent > 0) {
      lines.push(`📅 Dispatched ${eventResult.remindersSent} calendar event reminder(s)!`);
    } else {
      lines.push(`📅 No calendar reminders due (${eventResult.eventsChecked} upcoming checked).`);
    }

    if (todoResult.remindersSent > 0) {
      lines.push(`⏰ Dispatched ${todoResult.remindersSent} task reminder(s)!`);
    } else {
      lines.push(`⏰ No to-do reminders due (${todoResult.todosChecked} checked).`);
    }

    if (leaveNowSent > 0) {
      lines.push(`🚗 Dispatched ${leaveNowSent} leave-now alert(s)!`);
    }

    await sendTelegramMessage(chatId, lines.join("\n\n"));
    return { handled: true, completionStatus: "check_reminders" };
  }

  // Agenda today
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

    const events = await getUpcomingSchedule({ timeMin, timeMax, maxResults: 25 });
    if (events.length === 0) {
      await sendTelegramMessage(
        chatId,
        `📅 No events scheduled for today (${formatCalendarDate(sgTodayStr)}). Enjoy your day!`
      );
    } else {
      const formatted = formatScheduleAgendaView(events, {
        timeframe: "today",
        title: `Today’s Schedule (${formatCalendarDate(sgTodayStr)})`,
        calendarName: "all",
      });
      await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
    }
    return { handled: true, completionStatus: "agenda_today" };
  }

  // Calendar upcoming
  if (text === "/calendar" || text === "/calendar list" || text === "/calendar upcoming") {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const events = await getUpcomingSchedule({
      timeMin: now.toISOString(),
      timeMax: nextWeek.toISOString(),
      maxResults: 40,
    });

    if (events.length === 0) {
      await sendTelegramMessage(chatId, "📅 No upcoming calendar events found for the next 7 days.");
    } else {
      const formatted = formatScheduleAgendaView(events, {
        timeframe: "week",
        title: "Upcoming Schedule (Next 7 Days)",
        calendarName: "all",
      });
      await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
    }
    return { handled: true, completionStatus: "calendar_upcoming" };
  }

  // To-do list active
  if (text === "/todo" || text === "/todos" || text === "/tasks") {
    const todos = await listTodos({ status: "active" });
    const formatted = formatTodoListMessage(todos, "Active To-Do List");
    await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
    return { handled: true, completionStatus: "todo_list_command" };
  }

  // To-do list today
  if (text === "/todo today" || text === "/todotoday") {
    const todos = await listTodos({ date: "today", status: "active" });
    const formatted = formatTodoListMessage(todos, "Today's To-Do List");
    await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
    return { handled: true, completionStatus: "todo_today_command" };
  }

  // Remind command
  if (text.startsWith("/remind ") || text.startsWith("/todo remind ")) {
    const taskText = text.replace(/^\/(?:todo\s+)?remind\s+/, "").trim();
    if (!taskText) {
      await sendTelegramMessage(chatId, "Please specify what to remind you: `/remind <task>`");
      return { handled: true, completionStatus: "todo_remind_empty" };
    }
    await handleTodoAddAction({
      chatId,
      userId,
      task: taskText,
      remindIntervalMinutes: 30,
    });
    return { handled: true, completionStatus: "todo_remind_command" };
  }

  // Todo add command
  if (text.startsWith("/todo add ")) {
    const taskText = text.replace("/todo add ", "").trim();
    if (!taskText) {
      await sendTelegramMessage(chatId, "Please specify a task: `/todo add <task>`");
      return { handled: true, completionStatus: "todo_add_empty" };
    }
    await handleTodoAddAction({
      chatId,
      userId,
      task: taskText,
    });
    return { handled: true, completionStatus: "todo_add_command" };
  }

  // Todo done command
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
            { text: `✅ ${m.task}`, callback_data: `todo_done:${m.taskId}` },
          ]),
        }
      );
    }
    return { handled: true, completionStatus: "todo_done_command" };
  }

  // Gym / Workout commands
  if (
    text === "/gym" ||
    text === "/workout" ||
    lowerText === "gym" ||
    lowerText === "workout"
  ) {
    await handleWorkoutStartAction({ chatId, userId });
    return { handled: true, completionStatus: "gym_command" };
  }

  if (text === "/gym stats" || text === "/workout stats" || text === "/workout_stats") {
    await handleWorkoutViewAction({ chatId });
    return { handled: true, completionStatus: "gym_stats_command" };
  }

  if (text === "/gym setup" || text === "/workout setup") {
    const res = await setupWorkoutDashboardSheet();
    await sendTelegramMessage(chatId, `✅ ${res.message}`);
    return { handled: true, completionStatus: "gym_setup_command" };
  }

  // Finance help & summary
  if (text === "/finance") {
    await sendTelegramMessage(
      chatId,
      [
        "💰 *Finance Assistant*",
        "",
        "Speak or text naturally:",
        "• spent $6.20 for lunch",
        "• earned $100 freelance",
        "• how much did I spend this month?",
        "",
        "Or use commands:",
        "• `/finance summary` — Monthly spending breakdown",
        "• `/budget` — Budget status and progress",
        "• `/sync` — Sync recent DBS & Grab emails",
      ].join("\n")
    );
    return { handled: true, completionStatus: "finance_help" };
  }

  if (
    text === "/finance summary" ||
    text.startsWith("/finance summary ") ||
    text === "/finance_summary" ||
    text.startsWith("/finance_summary ") ||
    text === "/financesummary"
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
    return { handled: true, completionStatus: "finance_summary_command" };
  }

  // Budget
  if (
    text === "/budget" ||
    text.startsWith("/budget ") ||
    lowerText === "budget" ||
    lowerText === "my budget" ||
    text === "/finance budget"
  ) {
    if (await tryHandleBudgetSetCommand({ chatId, text })) {
      return { handled: true, completionStatus: "budget_set_command" };
    }
    const monthArg = text.replace("/finance budget", "").replace("/budget", "").trim();
    const summaryText = await formatBudgetSummary(monthArg);
    await sendTelegramMessage(chatId, summaryText);
    return { handled: true, completionStatus: "budget_command" };
  }

  // Split & Owed
  if (text === "/split" || text.startsWith("/split ")) {
    await handleSplitCommand({ chatId, text });
    return { handled: true, completionStatus: "split_command" };
  }

  if (text === "/owed" || text.startsWith("/owed ") || lowerText === "owed" || lowerText === "ious") {
    await handleOwedCommand({ chatId, text });
    return { handled: true, completionStatus: "owed_command" };
  }

  // Recurring
  if (text === "/recurring" || text.startsWith("/recurring ") || text === "/subscriptions") {
    await handleRecurringCommand({
      chatId,
      text: text === "/subscriptions" ? "/recurring" : text,
    });
    return { handled: true, completionStatus: "recurring_command" };
  }

  // Free slots
  if (text === "/freeslots" || text.startsWith("/freeslots ") || lowerText === "free slots") {
    const arg = text.replace("/freeslots", "").trim();
    const timeframe = arg.toLowerCase().includes("tomorrow") ? "tomorrow" : "today";
    await handleCalendarFreeSlotsAction({ chatId, intent: { timeframe } });
    return { handled: true, completionStatus: "freeslots_command" };
  }

  // Inbox triage
  if (text === "/inbox" || lowerText === "inbox" || lowerText === "unread emails") {
    await sendTelegramChatAction(chatId, "typing");
    try {
      const triage = await triageUnreadInbox(5);
      await sendTelegramMessage(chatId, triage.formattedSummary);
    } catch {
      await sendTelegramMessage(chatId, "⚠️ Could not check Gmail inbox. Ensure Gmail credentials are authorized.");
    }
    return { handled: true, completionStatus: "inbox_command" };
  }

  // Memory
  if (text === "/remember" || text.startsWith("/remember ")) {
    await handleRememberCommand({ chatId, text });
    return { handled: true, completionStatus: "remember_command" };
  }

  if (text === "/recall" || text.startsWith("/recall ")) {
    await handleRecallCommand({ chatId, text });
    return { handled: true, completionStatus: "recall_command" };
  }

  // Habits
  if (text === "/habits" || lowerText === "habits" || text.startsWith("/habit ")) {
    if (text.startsWith("/habit add ")) {
      const habitName = text.replace("/habit add ", "").trim();
      if (!habitName) {
        await sendTelegramMessage(chatId, "Usage: `/habit add <habit name>`");
      } else {
        const habit = await createHabit(habitName);
        await sendTelegramMessage(chatId, `✨ Created habit: *${habit.name}*! Streak tracking started.`);
      }
    } else if (text.startsWith("/habit done ")) {
      const habitName = text.replace("/habit done ", "").trim();
      const res = await logHabitDone(habitName);
      await sendTelegramMessage(chatId, res.message);
    } else {
      const habits = await listHabits();
      const summary = formatHabitsSummary(habits);
      await sendTelegramMessage(
        chatId,
        summary.text,
        summary.buttons.length ? { inline_keyboard: summary.buttons } : undefined
      );
    }
    return { handled: true, completionStatus: "habits_command" };
  }

  // Sync DBS & Grab
  if (text === "/sync" || lowerText === "sync transactions") {
    await sendTelegramMessage(chatId, "🔄 Syncing transactions from Gmail...");
    try {
      const res = await syncPayLahTransactions();
      await sendTelegramMessage(chatId, `✅ Synced ${res.logged} new transaction(s).`);
      return { handled: true, completionStatus: "sync_command" };
    } catch (err) {
      await sendTelegramMessage(chatId, `⚠️ Sync failed: ${err instanceof Error ? err.message : String(err)}`);
      return { handled: true, completionStatus: "sync_error" };
    }
  }

  // Undo command
  if (text === "/undo" || lowerText === "undo" || lowerText === "cancel that") {
    const res = await executeLatestUndo(userId);
    await sendTelegramMessage(chatId, res.message);
    return { handled: true, completionStatus: "undo_command" };
  }

  return { handled: false };
}
