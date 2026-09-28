import {
  getUpcomingSchedule,
  searchUpcomingCalendarEvents,
} from "@/lib/calendar";
import {
  formatScheduleAgendaView,
  formatSchedulePureTableView,
  ScheduleTimeframe,
} from "@/lib/calendar-format";
import {
  CalendarAddPayload,
  CalendarBatchAddPayload,
  cancelActivePendingCalendarAction,
  savePendingCalendarAction,
  savePendingCalendarBatchAction,
  savePendingCalendarSelection,
} from "@/lib/pending-actions";
import { sendTelegramMessage } from "@/lib/telegram";

export function formatSingaporeDateTime(value: string): string {
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

export function formatCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
  }).format(date);
}

export function formatCalendarEvent(input: {
  calendarName: "personal" | "work";
  title: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  date?: string;
  location?: string;
  reminderMinutes?: number;
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

  const lines = [
    `Calendar: ${input.calendarName === "work" ? "💼 Work" : "🏠 Personal"}`,
    `Title: ${input.title}`,
  ];

  if (input.location) {
    lines.push(`Location: 📍 ${input.location}`);
  }

  lines.push(...timeLines);

  if (input.reminderMinutes) {
    const hrs = Math.floor(input.reminderMinutes / 60);
    const mins = input.reminderMinutes % 60;
    const parts = [];
    if (hrs > 0) parts.push(`${hrs} hr${hrs > 1 ? "s" : ""}`);
    if (mins > 0) parts.push(`${mins} min${mins > 1 ? "s" : ""}`);
    lines.push(`Reminder: 🔔 ${parts.join(" ")} before`);
  }

  return lines.join("\n");
}

function truncateButtonText(text: string, maxLength = 60): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export async function handleCalendarViewAction(params: {
  chatId: number;
  calendarName?: "personal" | "work" | "all";
  timeframe?: "today" | "tomorrow" | "week" | "upcoming";
  text?: string;
}): Promise<void> {
  const { chatId, calendarName, timeframe, text } = params;
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

  if (timeframe === "today") {
    timeMin = `${sgTodayStr}T00:00:00+08:00`;
    timeMax = `${sgTodayStr}T23:59:59+08:00`;
    titleHeader = `Today’s Schedule (${formatCalendarDate(sgTodayStr)})`;
  } else if (timeframe === "tomorrow") {
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
  } else if (timeframe === "week") {
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    timeMin = now.toISOString();
    timeMax = weekEnd.toISOString();
    titleHeader = "Schedule for Next 7 Days";
  } else {
    timeMin = now.toISOString();
    titleHeader = "Upcoming Calendar Events";
  }

  const resolvedCalendarName = calendarName === "all" ? undefined : calendarName;

  const events = await getUpcomingSchedule({
    calendarName: resolvedCalendarName,
    timeMin,
    timeMax,
    maxResults: timeframe === "week" ? 40 : 25,
  });

  if (events.length === 0) {
    await sendTelegramMessage(
      chatId,
      `📅 No events found for ${
        timeframe === "today"
          ? "today"
          : timeframe === "tomorrow"
          ? "tomorrow"
          : "this period"
      }.`
    );
  } else {
    const wantsTable = /table|tabular|grid/i.test(text ?? "");
    const scheduleTf: ScheduleTimeframe = timeframe ?? "upcoming";
    const formatted = wantsTable
      ? formatSchedulePureTableView(events, {
          timeframe: scheduleTf,
          title: titleHeader,
          calendarName: resolvedCalendarName,
        })
      : formatScheduleAgendaView(events, {
          timeframe: scheduleTf,
          title: titleHeader,
          calendarName: resolvedCalendarName,
        });

    await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
  }
}

export async function handleCalendarAddAction(params: {
  chatId: number;
  userId: number;
  intent: CalendarAddPayload;
  hasActivePending?: boolean;
}): Promise<void> {
  const { chatId, userId, intent, hasActivePending } = params;

  if (hasActivePending) {
    await cancelActivePendingCalendarAction(userId);
  }

  const token = await savePendingCalendarAction({
    userId,
    payload: intent,
  });

  await sendTelegramMessage(
    chatId,
    ["Create this calendar event?", "", formatCalendarEvent(intent)].join("\n"),
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
}

export async function handleCalendarBatchAddAction(params: {
  chatId: number;
  userId: number;
  intent: CalendarBatchAddPayload;
  hasActivePending?: boolean;
}): Promise<void> {
  const { chatId, userId, intent, hasActivePending } = params;

  if (hasActivePending) {
    await cancelActivePendingCalendarAction(userId);
  }

  const token = await savePendingCalendarBatchAction({
    userId,
    payload: intent,
  });

  const eventPreviews = intent.events.map((ev, idx) => {
    const timing = ev.allDay
      ? `${formatCalendarDate(ev.date || "")} (All day)`
      : `${formatSingaporeDateTime(ev.start || "")} – ${formatSingaporeDateTime(ev.end || "")}`;
    const loc = ev.location ? `\n   📍 ${ev.location}` : "";
    return `${idx + 1}. ${ev.title}\n   📅 ${timing}${loc}`;
  });

  await sendTelegramMessage(
    chatId,
    [
      `I found ${intent.events.length} events for your ${intent.calendarName} calendar:`,
      "",
      eventPreviews.join("\n\n"),
      "",
      `Create all ${intent.events.length} events?`,
    ].join("\n"),
    {
      inline_keyboard: [
        [
          {
            text: `✅ Yes, create all (${intent.events.length})`,
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
}

export async function handleCalendarDeleteSearchAction(params: {
  chatId: number;
  userId: number;
  intent: {
    calendarName: "personal" | "work";
    query: string;
  };
}): Promise<boolean> {
  const { chatId, userId, intent } = params;
  const matches = await searchUpcomingCalendarEvents({
    calendarName: intent.calendarName,
    query: intent.query,
  });

  if (matches.length === 0) {
    await sendTelegramMessage(
      chatId,
      `No upcoming ${intent.calendarName} calendar events matched “${intent.query}”.`
    );
    return false;
  }

  const limitedMatches = matches.slice(0, 5);

  const selectionToken = await savePendingCalendarSelection({
    userId,
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
      `Found ${limitedMatches.length} upcoming ${intent.calendarName} calendar match${
        limitedMatches.length === 1 ? "" : "es"
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

  return true;
}
