import { getCalendarId } from "./calendars";
import { getCalendarClient } from "./google";
import { sendTelegramMessage } from "./telegram";

export type TimedCalendarEventInput = {
  calendarName: "personal" | "work";
  allDay?: false;
  title: string;
  start: string;
  end: string;
  location?: string;
  reminderMinutes?: number;
};

export type AllDayCalendarEventInput = {
  calendarName: "personal" | "work";
  allDay: true;
  title: string;
  date: string;
  location?: string;
  reminderMinutes?: number;
};

export type CreateEventInput =
  | TimedCalendarEventInput
  | AllDayCalendarEventInput;

export type CalendarEventMatch = {
  calendarName: "personal" | "work";
  eventId: string;
  title: string;
  start: string;
  end: string;
  location?: string | null;
  htmlLink: string | null;
};

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

function singaporeDateFromDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("The calendar event date is invalid.");
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function nextSingaporeDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00+08:00`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("The all-day event date is invalid.");
  }

  parsed.setUTCDate(parsed.getUTCDate() + 1);

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

async function insertAllDayEvent(input: {
  calendarName: "personal" | "work";
  title: string;
  date: string;
  location?: string;
  reminderMinutes?: number;
}): Promise<{
  id: string;
  htmlLink: string | null;
}> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId(input.calendarName);

  const reminderMinutes = input.reminderMinutes ?? 540; // Default: 9am day of event

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.title,
      location: input.location || undefined,
      start: {
        date: input.date,
      },
      end: {
        date: nextSingaporeDate(input.date),
      },
      extendedProperties: {
        private: {
          calendarName: input.calendarName,
          reminderMinutes: String(reminderMinutes),
          allDay: "true",
        },
      },
    },
  });

  return {
    id: response.data.id ?? "unknown",
    htmlLink: response.data.htmlLink ?? null,
  };
}

function formatSingaporeIso(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+08:00`;
}

export async function createCalendarEvent(
  input: CreateEventInput
): Promise<{
  id: string;
  htmlLink: string | null;
}> {
  if (input.allDay === true) {
    return insertAllDayEvent(input);
  }

  const start = new Date(input.start);
  let end = new Date(input.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("The calendar event time is invalid.");
  }

  const isSameInstant = start.getTime() === end.getTime();
  const isMidnightStart =
    start.getUTCHours() === 16 &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0;

  if (isSameInstant && isMidnightStart) {
    return insertAllDayEvent({
      calendarName: input.calendarName,
      title: input.title,
      date: singaporeDateFromDateTime(input.start),
      location: input.location,
      reminderMinutes: input.reminderMinutes,
    });
  }

  const finalStart = input.start;
  let finalEnd = input.end;

  if (end <= start) {
    // If end is equal to or earlier than start (e.g. deadline or single point in time),
    // default the duration to 30 minutes after start so Google Calendar accepts it.
    end = new Date(start.getTime() + 30 * 60 * 1000);
    finalEnd = formatSingaporeIso(end);
  }

  const reminderMinutes = input.reminderMinutes ?? 30;
  const remindersBody =
    input.reminderMinutes !== undefined
      ? {
          useDefault: false,
          overrides: [{ method: "popup", minutes: input.reminderMinutes }],
        }
      : undefined;

  const calendar = getCalendarClient();
  const calendarId = getCalendarId(input.calendarName);

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.title,
      location: input.location || undefined,
      start: {
        dateTime: finalStart,
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: finalEnd,
        timeZone: "Asia/Singapore",
      },
      reminders: remindersBody,
      extendedProperties: {
        private: {
          calendarName: input.calendarName,
          reminderMinutes: String(reminderMinutes),
        },
      },
    },
  });

  return {
    id: response.data.id ?? "unknown",
    htmlLink: response.data.htmlLink ?? null,
  };
}

export async function searchUpcomingCalendarEvents(input: {
  calendarName: "personal" | "work";
  query: string;
}): Promise<CalendarEventMatch[]> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId(input.calendarName);

  const response = await calendar.events.list({
    calendarId,
    timeMin: new Date().toISOString(),
    maxResults: 20,
    singleEvents: true,
    orderBy: "startTime",
    q: input.query.trim() || undefined,
  });

  return (response.data.items ?? [])
    .filter((event) => event.id && event.start)
    .slice(0, 10)
    .map((event) => ({
      calendarName: input.calendarName,
      eventId: event.id as string,
      title: event.summary ?? "Untitled event",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      location: event.location ?? null,
      htmlLink: event.htmlLink ?? null,
    }));
}

export async function deleteCalendarEvent(input: {
  calendarName: "personal" | "work";
  eventId: string;
}): Promise<void> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId(input.calendarName);

  await calendar.events.delete({
    calendarId,
    eventId: input.eventId,
  });
}

export type MoveCalendarEventInput = {
  fromCalendar: "personal" | "work";
  toCalendar: "personal" | "work";
  title: string;
  eventId?: string;
  allDay?: boolean;
  start?: string;
  end?: string;
  date?: string;
  location?: string;
};

export async function moveCalendarEvent(
  input: MoveCalendarEventInput
): Promise<{
  id: string;
  htmlLink: string | null;
  fromCalendar: "personal" | "work";
  toCalendar: "personal" | "work";
  title: string;
  start: string;
  end?: string;
  location?: string | null;
  allDay: boolean;
}> {
  const calendar = getCalendarClient();
  const fromCalId = getCalendarId(input.fromCalendar);

  let eventDetails: {
    title: string;
    allDay: boolean;
    start: string;
    end: string;
    date: string;
    location?: string | null;
  } | null = null;

  let targetOldEventId: string | null = input.eventId ?? null;

  if (targetOldEventId) {
    try {
      const existing = await calendar.events.get({
        calendarId: fromCalId,
        eventId: targetOldEventId,
      });

      const isAllDay = Boolean(existing.data.start?.date);
      eventDetails = {
        title: existing.data.summary || input.title,
        allDay: isAllDay,
        start: existing.data.start?.dateTime || existing.data.start?.date || "",
        end: existing.data.end?.dateTime || existing.data.end?.date || "",
        date: existing.data.start?.date || "",
        location: existing.data.location || input.location || null,
      };
    } catch {
      targetOldEventId = null;
    }
  }

  if (!targetOldEventId) {
    const matches = await searchUpcomingCalendarEvents({
      calendarName: input.fromCalendar,
      query: input.title,
    });

    if (matches.length > 0) {
      targetOldEventId = matches[0].eventId;
      const isAllDay = !matches[0].start.includes("T");
      eventDetails = {
        title: matches[0].title,
        allDay: isAllDay,
        start: matches[0].start,
        end: matches[0].end,
        date: isAllDay ? matches[0].start : "",
        location: matches[0].location || input.location || null,
      };
    }
  }

  if (!targetOldEventId) {
    throw new Error(
      `Could not find an event matching "${input.title}" on your ${input.fromCalendar} calendar to move.`
    );
  }

  const title = eventDetails?.title || input.title;
  const isAllDay = eventDetails?.allDay ?? input.allDay ?? Boolean(input.date);
  const start = eventDetails?.start || input.start || "";
  const end = eventDetails?.end || input.end || "";
  const location = eventDetails?.location || input.location || undefined;
  const date =
    eventDetails?.date ||
    input.date ||
    (start ? singaporeDateFromDateTime(start) : "");

  if (targetOldEventId) {
    try {
      await deleteCalendarEvent({
        calendarName: input.fromCalendar,
        eventId: targetOldEventId,
      });
    } catch (err) {
      console.warn("Failed to delete old event during move:", err);
    }
  }

  let createRes: { id: string; htmlLink: string | null };
  if (isAllDay) {
    createRes = await createCalendarEvent({
      calendarName: input.toCalendar,
      allDay: true,
      title,
      date:
        date ||
        nextSingaporeDate(singaporeDateFromDateTime(new Date().toISOString())),
      location,
    });
  } else {
    createRes = await createCalendarEvent({
      calendarName: input.toCalendar,
      allDay: false,
      title,
      start,
      end,
      location,
    });
  }

  return {
    id: createRes.id,
    htmlLink: createRes.htmlLink,
    fromCalendar: input.fromCalendar,
    toCalendar: input.toCalendar,
    title,
    start: isAllDay ? date : start,
    end: isAllDay ? undefined : end,
    location: location || null,
    allDay: isAllDay,
  };
}

export type ScheduleQueryOptions = {
  calendarName?: "personal" | "work" | "all";
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
};

export type ScheduleEventItem = {
  calendarName: "personal" | "work";
  eventId: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string | null;
  htmlLink: string | null;
};

export async function getUpcomingSchedule(
  options: ScheduleQueryOptions = {}
): Promise<ScheduleEventItem[]> {
  const calendar = getCalendarClient();
  const calendarTarget = options.calendarName ?? "all";
  const calendarsToQuery: Array<"personal" | "work"> =
    calendarTarget === "all"
      ? ["personal", "work"]
      : [calendarTarget];

  const nowIso = new Date().toISOString();
  const timeMin = options.timeMin ?? nowIso;
  const timeMax = options.timeMax;
  const maxResults = options.maxResults ?? 25;

  const results = await Promise.all(
    calendarsToQuery.map(async (calName) => {
      try {
        const calendarId = getCalendarId(calName);
        const response = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax: timeMax || undefined,
          maxResults,
          singleEvents: true,
          orderBy: "startTime",
        });

        return (response.data.items ?? [])
          .filter((event) => event.id && event.start)
          .map((event) => ({
            calendarName: calName,
            eventId: event.id as string,
            title: event.summary ?? "Untitled event",
            start: event.start?.dateTime ?? event.start?.date ?? "",
            end: event.end?.dateTime ?? event.end?.date ?? "",
            isAllDay: !event.start?.dateTime && Boolean(event.start?.date),
            location: event.location ?? null,
            htmlLink: event.htmlLink ?? null,
          }));
      } catch (err) {
        console.error(`Failed to list events for calendar ${calName}:`, err);
        return [];
      }
    })
  );

  const merged = results.flat();
  merged.sort((a, b) => {
    const aTime = new Date(a.start).getTime();
    const bTime = new Date(b.start).getTime();
    return aTime - bTime;
  });

  return merged.slice(0, maxResults);
}

export type ReminderCheckResult = {
  eventsChecked: number;
  remindersSent: number;
  sentEvents: Array<{
    title: string;
    calendarName: string;
    startsInMinutes: number;
    location?: string;
  }>;
};

export async function checkAndSendEventReminders(): Promise<ReminderCheckResult> {
  const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!allowedUserId) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID is missing.");
  }

  const calendar = getCalendarClient();
  const now = new Date();
  const nowIso = now.toISOString();

  // Scan events starting from now up to 24 hours ahead
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const timeMax = windowEnd.toISOString();

  let eventsChecked = 0;
  let remindersSent = 0;
  const sentEvents: ReminderCheckResult["sentEvents"] = [];

  const calendars: Array<"personal" | "work"> = ["personal", "work"];

  for (const calName of calendars) {
    try {
      const calendarId = getCalendarId(calName);
      const res = await calendar.events.list({
        calendarId,
        timeMin: nowIso,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
      });

      const items = res.data.items ?? [];
      eventsChecked += items.length;

      for (const item of items) {
        if (!item.id || !item.summary) continue;

        // Check if already reminded
        const privateProps = item.extendedProperties?.private ?? {};
        if (privateProps.botRemindedAt) {
          continue;
        }

        const isAllDay = Boolean(item.start?.date);
        let eventStart: Date;

        if (isAllDay) {
          // For all-day events, alert at 9:00 AM on the day of the event
          eventStart = new Date(`${item.start!.date}T09:00:00+08:00`);
        } else if (item.start?.dateTime) {
          eventStart = new Date(item.start.dateTime);
        } else {
          continue;
        }

        if (Number.isNaN(eventStart.getTime())) continue;

        // Reminder threshold in minutes (default to 30 mins or stored reminderMinutes)
        const customMinutes = privateProps.reminderMinutes
          ? Number(privateProps.reminderMinutes)
          : undefined;
        const reminderMinutes =
          customMinutes && !Number.isNaN(customMinutes) ? customMinutes : 30;

        const timeUntilStartMs = eventStart.getTime() - now.getTime();
        const timeUntilStartMinutes = Math.floor(timeUntilStartMs / (60 * 1000));

        // Trigger reminder if within the reminder window (and event has not passed by more than 5 minutes)
        if (timeUntilStartMinutes <= reminderMinutes && timeUntilStartMinutes >= -5) {
          const calBadge = calName === "work" ? "💼 Work" : "🏠 Personal";
          const locationLine = item.location ? `\n📍 *Location*: ${item.location}` : "";

          let timeDescription = "";
          if (timeUntilStartMinutes <= 0) {
            timeDescription = "Starting right now!";
          } else if (timeUntilStartMinutes < 60) {
            timeDescription = `Starting in ${timeUntilStartMinutes} min${
              timeUntilStartMinutes === 1 ? "" : "s"
            }!`;
          } else {
            const hrs = Math.floor(timeUntilStartMinutes / 60);
            const mins = timeUntilStartMinutes % 60;
            timeDescription =
              mins > 0
                ? `Starting in ${hrs}h ${mins}m!`
                : `Starting in ${hrs} hour${hrs === 1 ? "" : "s"}!`;
          }

          const timeLine = isAllDay
            ? `📅 Date: ${item.start!.date} (All day)`
            : `⏰ Time: ${formatSingaporeDateTime(item.start!.dateTime!)}`;

          const message = [
            `🔔 *Upcoming Event Reminder*`,
            "",
            `*${item.summary}*`,
            `Calendar: ${calBadge}`,
            timeLine,
            `⏳ ${timeDescription}`,
            locationLine,
            item.htmlLink
              ? `\n🔗 [Open in Google Calendar](${item.htmlLink})`
              : "",
          ]
            .filter(Boolean)
            .join("\n");

          await sendTelegramMessage(allowedUserId, message);

          // Mark as reminded on the event itself so we never notify twice
          await calendar.events.patch({
            calendarId,
            eventId: item.id,
            requestBody: {
              extendedProperties: {
                private: {
                  ...privateProps,
                  botRemindedAt: new Date().toISOString(),
                },
              },
            },
          });

          remindersSent++;
          sentEvents.push({
            title: item.summary,
            calendarName: calName,
            startsInMinutes: timeUntilStartMinutes,
            location: item.location || undefined,
          });
        }
      }
    } catch (err) {
      console.error(`Failed checking reminders for ${calName} calendar:`, err);
    }
  }

  return { eventsChecked, remindersSent, sentEvents };
}