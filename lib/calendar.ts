import { getCalendarId } from "./calendars";
import { getCalendarClient } from "./google";

export type TimedCalendarEventInput = {
  calendarName: "personal" | "work";
  allDay?: false;
  title: string;
  start: string;
  end: string;
};

export type AllDayCalendarEventInput = {
  calendarName: "personal" | "work";
  allDay: true;
  title: string;
  date: string;
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
  htmlLink: string | null;
};

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
}): Promise<{
  id: string;
  htmlLink: string | null;
}> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId(input.calendarName);

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.title,
      start: {
        date: input.date,
      },
      end: {
        date: nextSingaporeDate(input.date),
      },
    },
  });

  return {
    id: response.data.id ?? "unknown",
    htmlLink: response.data.htmlLink ?? null,
  };
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
  const end = new Date(input.end);

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
    });
  }

  if (end <= start) {
    throw new Error("The event end time must be after its start time.");
  }

  const calendar = getCalendarClient();
  const calendarId = getCalendarId(input.calendarName);

  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.title,
      start: {
        dateTime: input.start,
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: input.end,
        timeZone: "Asia/Singapore",
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