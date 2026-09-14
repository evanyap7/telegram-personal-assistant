import type { ScheduleEventItem } from "./calendar";
import type { InlineKeyboardMarkup } from "./telegram";

export type ScheduleTimeframe = "today" | "tomorrow" | "week" | "upcoming";

export interface FormatScheduleOptions {
  timeframe?: ScheduleTimeframe;
  title?: string;
  calendarName?: "personal" | "work" | "all";
}

/**
 * Extracts Singapore date key YYYY-MM-DD from an ISO string or date-only string.
 */
export function getSingaporeDateKey(isoOrDateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDateStr)) {
    return isoOrDateStr;
  }
  const date = new Date(isoOrDateStr);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Formats a Singapore date key (YYYY-MM-DD) into a human readable day string, e.g. "Mon, 14 Sep"
 */
export function formatSingaporeDayHeader(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/**
 * Formats a fixed 11-character time badge for monospace alignment:
 * All day: "All-Day    "
 * Timed:   "09:00–18:00"
 */
export function formatSingaporeTimeBadge(start: string, end: string, isAllDay: boolean): string {
  if (isAllDay) {
    return "All-Day    ";
  }
  const startDate = new Date(start);
  const endDate = new Date(end);

  const startStr = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(startDate);

  const endStr = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(endDate);

  return `${startStr}–${endStr}`;
}

/**
 * Legacy formatter for a single schedule event item.
 */
export function formatSingaporeScheduleItem(item: ScheduleEventItem): string {
  const calBadge = item.calendarName === "work" ? "💼 Work" : "🏠 Personal";
  if (item.isAllDay) {
    const [year, month, day] = getSingaporeDateKey(item.start).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dateFormatted = new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
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

/**
 * Builds the inline keyboard markup for toggling between Agenda and Pure Table views.
 */
export function buildScheduleReplyMarkup(
  currentMode: "agenda" | "table",
  timeframe: ScheduleTimeframe = "week",
  calendarName: "personal" | "work" | "all" = "all"
): InlineKeyboardMarkup {
  if (currentMode === "agenda") {
    return {
      inline_keyboard: [
        [
          {
            text: "📊 Table View",
            callback_data: `cal_mode:table:${timeframe}:${calendarName}`,
          },
          {
            text: "🔄 Refresh",
            callback_data: `cal_mode:refresh_agenda:${timeframe}:${calendarName}`,
          },
        ],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text: "📋 Agenda View",
          callback_data: `cal_mode:agenda:${timeframe}:${calendarName}`,
        },
        {
          text: "🔄 Refresh",
          callback_data: `cal_mode:refresh_table:${timeframe}:${calendarName}`,
        },
      ],
    ],
  };
}

/**
 * Sleek Tabular Agenda View:
 * - Shows a concise "Week at a Glance" matrix table at the top for multi-day views.
 * - Groups events day-by-day with fixed-width monospace time badges that align titles into vertical columns.
 */
export function formatScheduleAgendaView(
  events: ScheduleEventItem[],
  options: FormatScheduleOptions = {}
): { text: string; replyMarkup: InlineKeyboardMarkup } {
  const timeframe = options.timeframe ?? "week";
  const calendarName = options.calendarName ?? "all";
  const title = options.title ?? (timeframe === "today" ? "Today’s Schedule" : "Schedule for Next 7 Days");

  if (!events || events.length === 0) {
    return {
      text: `📅 *${title}*\n\nNo scheduled events found. Enjoy your free time! 🌴`,
      replyMarkup: buildScheduleReplyMarkup("agenda", timeframe, calendarName),
    };
  }

  // Group events by Singapore date
  const groups = new Map<string, ScheduleEventItem[]>();
  for (const item of events) {
    const key = getSingaporeDateKey(item.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const lines: string[] = [];
  lines.push(`📅 *${title}* (${events.length} event${events.length === 1 ? "" : "s"})`);
  lines.push("");

  // Only render the Week at a Glance mini-table if it's a multi-day view
  if (timeframe === "week" || timeframe === "upcoming") {
    lines.push("📊 *Week at a Glance:*");
    lines.push("```");
    lines.push("DAY        TOTAL  BREAKDOWN");
    lines.push("───────────────────────────");

    // Determine 7-day span starting from the first event date (or Singapore today)
    const nowSgKey = getSingaporeDateKey(new Date().toISOString());
    const firstKey = groups.keys().next().value ?? nowSgKey;
    const [y, m, d] = firstKey.split("-").map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, d));

    for (let i = 0; i < 7; i++) {
      const curr = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const currKey = curr.toISOString().slice(0, 10);
      const dayLabel = formatSingaporeDayHeader(currKey).padEnd(10, " ");
      const dayEvents = groups.get(currKey);

      if (!dayEvents || dayEvents.length === 0) {
        lines.push(`${dayLabel}   –    Free 🌴`);
      } else {
        const workCount = dayEvents.filter((e) => e.calendarName === "work").length;
        const personalCount = dayEvents.filter((e) => e.calendarName === "personal").length;
        const totalStr = `${dayEvents.length}`.padStart(2, " ");
        const parts: string[] = [];
        if (workCount > 0) parts.push(`W:${workCount}`);
        if (personalCount > 0) parts.push(`P:${personalCount}`);
        lines.push(`${dayLabel}  ${totalStr}    ${parts.join(" ")}`);
      }
    }
    lines.push("```");
    lines.push("");
  }

  // Detailed Day-by-Day Agenda with Monospace Aligned Time Badges
  for (const [dateKey, dayEvents] of groups.entries()) {
    const dayTitle = formatSingaporeDayHeader(dateKey);
    lines.push(`🗓 *${dayTitle}* (${dayEvents.length})`);

    for (const ev of dayEvents) {
      const timeBadge = formatSingaporeTimeBadge(ev.start, ev.end, ev.isAllDay);
      const calIcon = ev.calendarName === "work" ? "💼" : "🏠";
      lines.push(`\`${timeBadge}\` ${ev.title} ${calIcon}`);
    }
    lines.push("");
  }

  return {
    text: lines.join("\n").trim(),
    replyMarkup: buildScheduleReplyMarkup("agenda", timeframe, calendarName),
  };
}

/**
 * Pure Table View:
 * Full ASCII timetable grid formatted into monospace code block, fitting standard mobile screen widths.
 */
export function formatSchedulePureTableView(
  events: ScheduleEventItem[],
  options: FormatScheduleOptions = {}
): { text: string; replyMarkup: InlineKeyboardMarkup } {
  const timeframe = options.timeframe ?? "week";
  const calendarName = options.calendarName ?? "all";
  const title = options.title ?? "Timetable Table View";

  if (!events || events.length === 0) {
    return {
      text: `📅 *${title}*\n\nNo scheduled events found. Enjoy your free time! 🌴`,
      replyMarkup: buildScheduleReplyMarkup("table", timeframe, calendarName),
    };
  }

  const groups = new Map<string, ScheduleEventItem[]>();
  for (const item of events) {
    const key = getSingaporeDateKey(item.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const lines: string[] = [];
  lines.push(`📅 *${title}* (${events.length} event${events.length === 1 ? "" : "s"})`);
  lines.push("");
  lines.push("```");
  lines.push("TIME        EVENT               CAL");
  lines.push("───────────────────────────────────");

  for (const [dateKey, dayEvents] of groups.entries()) {
    const dayHeader = `[${formatSingaporeDayHeader(dateKey)}]`;
    lines.push(dayHeader);

    for (const ev of dayEvents) {
      const time = ev.isAllDay
        ? "All-Day    "
        : formatSingaporeTimeBadge(ev.start, ev.end, false).padEnd(11, " ");

      // Truncate title cleanly to 19 chars for mobile table fit
      let cleanTitle = ev.title.trim();
      if (cleanTitle.length > 19) {
        cleanTitle = cleanTitle.slice(0, 18) + "…";
      } else {
        cleanTitle = cleanTitle.padEnd(19, " ");
      }

      const calTag = ev.calendarName === "work" ? "[W]" : "[P]";
      lines.push(`${time} ${cleanTitle} ${calTag}`);
    }
    lines.push("───────────────────────────────────");
  }
  lines.push("[W] = 💼 Work  •  [P] = 🏠 Personal");
  lines.push("```");

  return {
    text: lines.join("\n").trim(),
    replyMarkup: buildScheduleReplyMarkup("table", timeframe, calendarName),
  };
}
