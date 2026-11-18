import { listBusyEvents } from "../calendar";
import type { BusyInterval } from "./slots";

/** The only calendar data allowed into lib/guest: no title, location, etc. */
export interface BusyEvent {
  start: string;
  end: string;
  isAllDay: boolean;
}

type LoadFn = (fromIso: string, toIso: string) => Promise<BusyEvent[]>;

// Rejects on any calendar failure (fail closed); callers must not swallow it.
const defaultLoad: LoadFn = (timeMin, timeMax) => listBusyEvents(timeMin, timeMax);

export async function fetchBusyIntervals(
  fromDate: string,
  toDate: string,
  load: LoadFn = defaultLoad
): Promise<BusyInterval[]> {
  const events = await load(
    `${fromDate}T00:00:00+08:00`,
    `${toDate}T23:59:59+08:00`
  );
  const out: BusyInterval[] = [];
  for (const ev of events) {
    if (ev.isAllDay) continue;
    const start = Date.parse(ev.start);
    const end = Date.parse(ev.end);
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    out.push({ start, end });
  }
  return out;
}
