import { getCalendarId } from "./calendars";
import { getCalendarClient } from "./google";

type CreateEventInput = {
  calendarName: "personal" | "work";
  title: string;
  start: string;
  end: string;
};

export async function createCalendarEvent(input: CreateEventInput) {
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