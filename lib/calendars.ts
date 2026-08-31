export const CALENDARS = {
  personal: process.env.GOOGLE_CALENDAR_ID_PERSONAL,
  work: process.env.GOOGLE_CALENDAR_ID_WORK,
} as const;

export type CalendarName = keyof typeof CALENDARS;

export function getCalendarId(name: CalendarName): string {
  const calendarId = CALENDARS[name];

  if (!calendarId) {
    throw new Error(`Calendar "${name}" is not configured.`);
  }

  return calendarId;
}