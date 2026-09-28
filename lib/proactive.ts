import { getUpcomingSchedule, type ScheduleEventItem } from "./calendar";
import { listTodos, type TodoItem } from "./todos";
import { getMonthlyBudgetStatus, type MonthlyBudgetStatus } from "./budget";
import {
  getFinanceSummary,
  listTransactionsFromSheet,
  resolveMonthSheetName,
  parseSingaporeTimestamp,
  type FinanceSummary,
  type CategorySpending,
} from "./finance";
import { sendTelegramMessage } from "./telegram";
import { formatCalendarDate } from "./handlers/calendar-handler";
import { triageUnreadInbox, type InboxTriageSummary } from "./inbox-triage";
import {
  listHabits,
  type HabitItem,
  getTodaySingaporeDate,
} from "./habits";

function getSingaporeDayBounds(): {
  startIso: string;
  endIso: string;
  todayStr: string;
  daysRemainingInMonth: number;
  monthName: string;
} {
  const now = new Date();
  const sgFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = sgFormatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // SGT is UTC+8
  const startIso = new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0)).toISOString();
  const endIso = new Date(Date.UTC(year, month - 1, day, 15, 59, 59, 999)).toISOString();

  // Days in month
  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const daysRemainingInMonth = Math.max(1, totalDaysInMonth - day + 1);

  const monthName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    month: "long",
  }).format(now);

  return { startIso, endIso, todayStr, daysRemainingInMonth, monthName };
}

function getSingaporeTomorrowBounds(): {
  startIso: string;
  endIso: string;
  tomorrowStr: string;
} {
  const now = new Date();
  const sgFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Tomorrow
  const tParts = sgFormatter.formatToParts(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const tYear = Number(tParts.find((p) => p.type === "year")?.value);
  const tMonth = Number(tParts.find((p) => p.type === "month")?.value);
  const tDay = Number(tParts.find((p) => p.type === "day")?.value);

  const tomorrowStr = `${tYear}-${String(tMonth).padStart(2, "0")}-${String(tDay).padStart(2, "0")}`;
  const startIso = new Date(Date.UTC(tYear, tMonth - 1, tDay, -8, 0, 0, 0)).toISOString();
  const endIso = new Date(Date.UTC(tYear, tMonth - 1, tDay, 15, 59, 59, 999)).toISOString();

  return { startIso, endIso, tomorrowStr };
}

function formatEventTime(isoString: string, isAllDay: boolean): string {
  if (isAllDay) return "All day";
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Singapore",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return "";
  }
}

export interface MorningBriefData {
  events: ScheduleEventItem[];
  todosDueToday: TodoItem[];
  overdueTodos: TodoItem[];
  budgetStatus: MonthlyBudgetStatus;
  daysRemainingInMonth: number;
  monthName: string;
  inboxTriage?: InboxTriageSummary;
}

export async function aggregateMorningBrief(): Promise<MorningBriefData> {
  const { startIso, endIso, todayStr, daysRemainingInMonth, monthName } = getSingaporeDayBounds();

  const [events, allTodos, budgetStatus, inboxTriage] = await Promise.all([
    getUpcomingSchedule({
      timeMin: startIso,
      timeMax: endIso,
      calendarName: "all",
      maxResults: 20,
    }).catch(() => [] as ScheduleEventItem[]),
    listTodos({ status: "active" }).catch(() => [] as TodoItem[]),
    getMonthlyBudgetStatus().catch(
      () =>
        ({
          hasBudget: false,
          budget: 0,
          totalExpenses: 0,
          remaining: 0,
          percentUsed: 0,
          isOverBudget: false,
          currency: "SGD",
        } as MonthlyBudgetStatus)
    ),
    triageUnreadInbox(3).catch(() => undefined),
  ]);

  const todosDueToday: TodoItem[] = [];
  const overdueTodos: TodoItem[] = [];

  for (const todo of allTodos) {
    if (!todo.dueDate) continue;
    if (todo.dueDate === todayStr) {
      todosDueToday.push(todo);
    } else if (todo.dueDate < todayStr) {
      overdueTodos.push(todo);
    }
  }

  return {
    events,
    todosDueToday,
    overdueTodos,
    budgetStatus,
    daysRemainingInMonth,
    monthName,
    inboxTriage,
  };
}

export function formatMorningBrief(data: MorningBriefData): string {
  const lines: string[] = ["🌅 Good morning! Here's your day ahead:\n"];

  // 1. Calendar Events
  if (data.events.length === 0) {
    lines.push("📅 Calendar: No events scheduled for today. Free day!");
  } else {
    lines.push(`📅 Today's Schedule (${data.events.length} event${data.events.length === 1 ? "" : "s"}):`);
    for (const ev of data.events) {
      const badge = ev.calendarName === "work" ? "💼" : "🏠";
      const timeStr = formatEventTime(ev.start, ev.isAllDay);
      lines.push(`  • ${badge} ${timeStr}: ${ev.title}`);
    }
  }
  lines.push("");

  // 2. Tasks
  const taskCount = data.todosDueToday.length + data.overdueTodos.length;
  if (taskCount === 0) {
    lines.push("📝 Tasks: No tasks due today. You're all caught up!");
  } else {
    lines.push(`📝 Tasks to focus on:`);
    for (const todo of data.overdueTodos) {
      lines.push(`  • ⚠️ ${todo.task} (Overdue: due ${formatCalendarDate(todo.dueDate)})`);
    }
    for (const todo of data.todosDueToday) {
      const pIcon = todo.priority === "high" ? "🔴 " : "";
      lines.push(`  • ${pIcon}${todo.task} (Due today)`);
    }
  }
  lines.push("");

  // 3. Budget Status
  if (data.budgetStatus.hasBudget) {
    const { budget, totalExpenses, remaining, percentUsed, isOverBudget, currency } = data.budgetStatus;
    const dailyAllowance = Math.max(0, remaining / data.daysRemainingInMonth);

    lines.push("💰 Monthly Budget:");
    if (isOverBudget) {
      lines.push(
        `  • 🚨 Exceeded by ${Math.abs(remaining).toFixed(2)} ${currency} (${totalExpenses.toFixed(2)} spent of ${budget.toFixed(2)})`
      );
    } else {
      lines.push(
        `  • Spent: $${totalExpenses.toFixed(2)} of $${budget.toFixed(2)} (${percentUsed.toFixed(1)}%)`
      );
      lines.push(
        `  • Remaining: $${remaining.toFixed(2)} (~$${dailyAllowance.toFixed(2)}/day for ${data.daysRemainingInMonth} more day${
          data.daysRemainingInMonth === 1 ? "" : "s"
        } in ${data.monthName})`
      );
    }
  }

  // 4. Inbox
  if (data.inboxTriage && data.inboxTriage.actionableCount > 0) {
    lines.push(
      "",
      `📬 Inbox (${data.inboxTriage.actionableCount} actionable email${
        data.inboxTriage.actionableCount === 1 ? "" : "s"
      }):`
    );
    for (const em of data.inboxTriage.emails.slice(0, 2)) {
      lines.push(`  • ${em.fromName}: "${em.subject}"`);
    }
  } else if (data.inboxTriage && data.inboxTriage.totalUnread === 0) {
    lines.push("", "📬 Inbox: Zero unread emails!");
  }

  return lines.join("\n").trim();
}

export async function sendMorningBrief(chatId?: number): Promise<string> {
  const targetChatId = chatId ?? Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!targetChatId) {
    throw new Error("No recipient chatId provided or TELEGRAM_ALLOWED_USER_ID configured.");
  }

  const data = await aggregateMorningBrief();
  const text = formatMorningBrief(data);
  await sendTelegramMessage(targetChatId, text);
  return text;
}

// ---------------------------------------------------------------------------
// Evening Recap
// ---------------------------------------------------------------------------

export interface EveningRecapData {
  financeSummary: FinanceSummary;
  openTodos: TodoItem[];
  tomorrowsFirstEvent?: ScheduleEventItem;
  habits?: HabitItem[];
}

export async function aggregateEveningRecap(): Promise<EveningRecapData> {
  const { startIso, endIso } = getSingaporeTomorrowBounds();

  const [financeSummary, openTodos, tomorrowsEvents, habits] = await Promise.all([
    getFinanceSummary("today").catch(
      () =>
        ({
          period: "today",
          totalIncome: 0,
          totalExpense: 0,
          netSavings: 0,
          currency: "SGD",
          transactionCount: 0,
          categories: [],
        } as FinanceSummary)
    ),
    listTodos({ status: "active" }).catch(() => [] as TodoItem[]),
    getUpcomingSchedule({
      timeMin: startIso,
      timeMax: endIso,
      calendarName: "all",
      maxResults: 1,
    }).catch(() => [] as ScheduleEventItem[]),
    listHabits().catch(() => [] as HabitItem[]),
  ]);

  return {
    financeSummary,
    openTodos,
    tomorrowsFirstEvent: tomorrowsEvents[0],
    habits,
  };
}

export function formatEveningRecap(data: EveningRecapData): string {
  const lines: string[] = ["🌙 Good evening! Here's your recap:\n"];

  // 1. Finance summary for today
  const { totalExpense, transactionCount, categories, currency } = data.financeSummary;
  lines.push("💰 Today's Spending:");
  if (transactionCount === 0 || totalExpense === 0) {
    lines.push("  • No expenses logged today. Zero-spend day! 🎉");
  } else {
    lines.push(
      `  • Spent: $${totalExpense.toFixed(2)} ${currency} across ${transactionCount} transaction${
        transactionCount === 1 ? "" : "s"
      }`
    );
    if (categories.length > 0) {
      const topCats = categories
        .slice(0, 3)
        .map((c) => `${c.category}: $${c.amount.toFixed(2)}`)
        .join(", ");
      lines.push(`  • Top: ${topCats}`);
    }
  }
  lines.push("");

  // 2. Open tasks
  lines.push(`📝 Tasks Still Open (${data.openTodos.length}):`);
  if (data.openTodos.length === 0) {
    lines.push("  • All tasks completed! Great job today.");
  } else {
    const previewTodos = data.openTodos.slice(0, 5);
    for (const todo of previewTodos) {
      const pIcon = todo.priority === "high" ? "🔴 " : "";
      lines.push(`  • ${pIcon}${todo.task}`);
    }
    if (data.openTodos.length > 5) {
      lines.push(`  • ...and ${data.openTodos.length - 5} more`);
    }
  }
  lines.push("");

  // 3. Tomorrow's first event
  lines.push("📅 Tomorrow's First Event:");
  if (data.tomorrowsFirstEvent) {
    const ev = data.tomorrowsFirstEvent;
    const badge = ev.calendarName === "work" ? "💼" : "🏠";
    const timeStr = formatEventTime(ev.start, ev.isAllDay);
    lines.push(`  • ${badge} ${timeStr}: ${ev.title}`);
  } else {
    lines.push("  • Nothing scheduled yet for tomorrow morning.");
  }

  // 4. Habits review
  if (data.habits && data.habits.length > 0) {
    lines.push("");
    const today = getTodaySingaporeDate();
    const completed = data.habits.filter((h) => h.lastCompletedDate === today);
    const pending = data.habits.filter((h) => h.lastCompletedDate !== today);

    lines.push(`🔥 Habits Today (${completed.length}/${data.habits.length} completed):`);
    for (const h of completed) {
      const streak = h.currentStreak > 0 ? ` (${h.currentStreak}d streak 🔥)` : "";
      lines.push(`  • ✅ ${h.name}${streak}`);
    }
    for (const h of pending) {
      lines.push(`  • ⬜ ${h.name}`);
    }
  }

  return lines.join("\n").trim();
}

export async function sendEveningRecap(chatId?: number): Promise<string> {
  const targetChatId = chatId ?? Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!targetChatId) {
    throw new Error("No recipient chatId provided or TELEGRAM_ALLOWED_USER_ID configured.");
  }

  const data = await aggregateEveningRecap();
  const text = formatEveningRecap(data);

  // If there are pending habits today, attach quick check-off buttons
  const today = getTodaySingaporeDate();
  const pendingHabits = (data.habits || []).filter((h) => h.lastCompletedDate !== today);

  const replyMarkup =
    pendingHabits.length > 0
      ? {
          inline_keyboard: pendingHabits.map((h) => [
            {
              text: `Check ${h.name.length > 25 ? h.name.slice(0, 24) + "…" : h.name}`,
              callback_data: `habit_done:${h.habitId}`,
            },
          ]),
        }
      : undefined;

  await sendTelegramMessage(targetChatId, text, replyMarkup);
  return text;
}

// ---------------------------------------------------------------------------
// Sunday / Weekly Spending Report
// ---------------------------------------------------------------------------

export interface WeeklyReportData {
  thisWeekExpenses: number;
  lastWeekExpenses: number;
  percentChange: number;
  currency: string;
  topCategories: CategorySpending[];
  transactionCount: number;
}

export async function aggregateWeeklyReport(): Promise<WeeklyReportData> {
  const now = new Date();
  const currentMonthSheet = await resolveMonthSheetName(now);
  let transactions = await listTransactionsFromSheet(currentMonthSheet);

  // If in first 14 days of the month, load previous month as well
  const dayOfMonth = parseInt(
    new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      day: "numeric",
    }).format(now),
    10
  );

  if (dayOfMonth <= 14) {
    const prevMonthDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const prevMonthSheet = await resolveMonthSheetName(prevMonthDate);
    if (prevMonthSheet !== currentMonthSheet) {
      const prevTxns = await listTransactionsFromSheet(prevMonthSheet);
      transactions = [...transactions, ...prevTxns];
    }
  }

  const sgToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const todayMidnight = new Date(`${sgToday}T00:00:00+08:00`);
  const sevenDaysAgo = new Date(todayMidnight.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(todayMidnight.getTime() - 14 * 24 * 60 * 60 * 1000);

  let thisWeekExpenses = 0;
  let lastWeekExpenses = 0;
  let thisWeekCount = 0;
  let currency = "SGD";
  const categoryMap: Record<string, number> = {};

  for (const txn of transactions) {
    if (txn.status !== "active" || txn.type.toLowerCase() !== "expense") continue;

    const txnDate = parseSingaporeTimestamp(txn.timestamp);
    if (!txnDate) continue;

    const amt = parseFloat(txn.amount) || 0;
    if (txn.currency) currency = txn.currency.toUpperCase();

    if (txnDate >= sevenDaysAgo) {
      thisWeekExpenses += amt;
      thisWeekCount++;
      const cat = txn.category.trim() || "Uncategorized";
      categoryMap[cat] = (categoryMap[cat] || 0) + amt;
    } else if (txnDate >= fourteenDaysAgo && txnDate < sevenDaysAgo) {
      lastWeekExpenses += amt;
    }
  }

  const percentChange =
    lastWeekExpenses > 0
      ? ((thisWeekExpenses - lastWeekExpenses) / lastWeekExpenses) * 100
      : 0;

  const topCategories: CategorySpending[] = Object.entries(categoryMap)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: thisWeekExpenses > 0 ? (amount / thisWeekExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    thisWeekExpenses,
    lastWeekExpenses,
    percentChange,
    currency,
    topCategories,
    transactionCount: thisWeekCount,
  };
}

export function formatWeeklyReport(data: WeeklyReportData): string {
  const lines: string[] = ["📊 Weekly Spending Report:\n"];

  const changeSign = data.percentChange >= 0 ? "+" : "";
  const changeStr =
    data.lastWeekExpenses > 0
      ? ` (${changeSign}${data.percentChange.toFixed(1)}% vs last week)`
      : "";

  lines.push(`• This week: $${data.thisWeekExpenses.toFixed(2)} ${data.currency} (${data.transactionCount} transactions)`);
  if (data.lastWeekExpenses > 0) {
    lines.push(`• Last week: $${data.lastWeekExpenses.toFixed(2)} ${data.currency}${changeStr}`);
  }
  lines.push("");

  if (data.topCategories.length > 0) {
    lines.push("🏷️ Top Spending Categories:");
    data.topCategories.slice(0, 5).forEach((cat, idx) => {
      lines.push(
        `  ${idx + 1}. ${cat.category}: $${cat.amount.toFixed(2)} (${cat.percentage.toFixed(1)}%)`
      );
    });
  } else {
    lines.push("No expense categories recorded for this week.");
  }

  return lines.join("\n").trim();
}

export async function sendWeeklyReport(chatId?: number): Promise<string> {
  const targetChatId = chatId ?? Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!targetChatId) {
    throw new Error("No recipient chatId provided or TELEGRAM_ALLOWED_USER_ID configured.");
  }

  const data = await aggregateWeeklyReport();
  const text = formatWeeklyReport(data);
  await sendTelegramMessage(targetChatId, text);
  return text;
}
