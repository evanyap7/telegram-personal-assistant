export const CALENDARS = {
  personal: process.env.GOOGLE_CALENDAR_ID_PERSONAL,
  work: process.env.GOOGLE_CALENDAR_ID_WORK,
} as const;

export type CalendarName = keyof typeof CALENDARS;

export function getCalendarId(name: string): string {
  const normalized = name.trim().toLowerCase() as CalendarName;
  const calendarId = CALENDARS[normalized];

  if (!calendarId) {
    throw new Error(
      "Unknown calendar. Choose one of: personal, work."
    );
  }

  return calendarId;
}
