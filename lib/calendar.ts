import { getCalendarId } from "./calendars";
import { getCalendarClient } from "./google";

export type CreateEventInput = {
  calendarName: "personal" | "work";
  title: string;
  start: string;
  end: string;
};

export type CalendarEventMatch = {
  calendarName: "personal" | "work";
  eventId: string;
  title: string;
  start: string;
  end: string;
  htmlLink: string | null;
};

export async function createCalendarEvent(input: CreateEventInput): Promise<{
  id: string;
  htmlLink: string | null;
}> {
  const start = new Date(input.start);
  const end = new Date(input.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("The calendar event time is invalid.");
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
        dateTime: start.toISOString(),
        timeZone: "Asia/Singapore",
      },
      end: {
        dateTime: end.toISOString(),
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