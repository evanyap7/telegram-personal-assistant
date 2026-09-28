import { getUpcomingSchedule, type ScheduleEventItem } from "./calendar";
import { listTodos, type TodoItem, getSingaporeTodayDate } from "./todos";
import { getMonthlyBudgetStatus, type MonthlyBudgetStatus } from "./budget";
import { sendTelegramMessage } from "./telegram";
import { formatCalendarDate } from "./handlers/calendar-handler";

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
}

export async function aggregateMorningBrief(): Promise<MorningBriefData> {
  const { startIso, endIso, todayStr, daysRemainingInMonth, monthName } = getSingaporeDayBounds();

  const [events, allTodos, budgetStatus] = await Promise.all([
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
