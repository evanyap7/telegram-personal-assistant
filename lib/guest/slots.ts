import { calculateFreeSlotsFromIntervals } from "../calendar";

export const GUEST_RULES = {
  startHour: 10,
  endHour: 21,
  paddingMin: 15,
  horizonDays: 14,
  defaultDurationMin: 60,
} as const;

export type PartOfDay = "morning" | "afternoon" | "evening";
export interface BusyInterval {
  start: number;
  end: number;
}
export interface Slot {
  start: string;
  end: string;
}
export interface DayWindows {
  date: string;
  windows: Slot[];
}

const SGT_OFFSET_MS = 8 * 3_600_000;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

const PART_HOURS: Record<PartOfDay, [number, number]> = {
  morning: [10, 12],
  afternoon: [12, 17],
  evening: [17, 21],
};

function sgtDate(ms: number): string {
  return new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function sgtHourMs(date: string, hour: number): number {
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`);
}

function toSgtIso(ms: number): string {
  return new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 19) + "+08:00";
}

export function computeGuestWindows(i: {
  busy: BusyInterval[];
  fromDate: string;
  toDate: string;
  partOfDay?: PartOfDay;
  durationMin: number;
  nowMs: number;
}): DayWindows[] {
  const today = sgtDate(i.nowMs);
  const maxDate = addDays(today, GUEST_RULES.horizonDays);
  const from = i.fromDate < today ? today : i.fromDate;
  const to = i.toDate > maxDate ? maxDate : i.toDate;
  if (from > to) return [];

  const [startHour, endHour] = i.partOfDay
    ? PART_HOURS[i.partOfDay]
    : [GUEST_RULES.startHour, GUEST_RULES.endHour];
  const pad = GUEST_RULES.paddingMin * MIN_MS;
  const padded = i.busy.map((b) => ({ start: b.start - pad, end: b.end + pad }));

  const out: DayWindows[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dayStart = Math.max(sgtHourMs(d, startHour), i.nowMs);
    const dayEnd = sgtHourMs(d, endHour);
    const windows: Slot[] =
      dayEnd > dayStart
        ? calculateFreeSlotsFromIntervals(padded, dayStart, dayEnd, i.durationMin).map(
            (s) => ({
              start: toSgtIso(Date.parse(s.start)),
              end: toSgtIso(Date.parse(s.end)),
            })
          )
        : [];
    out.push({ date: d, windows });
  }
  return out;
}

export function pickCandidateSlots(
  days: DayWindows[],
  durationMin: number,
  max = 8,
  perDay = 3
): Slot[] {
  const step = 30 * MIN_MS;
  const dur = durationMin * MIN_MS;
  const picked: Slot[] = [];
  for (const day of days) {
    let count = 0;
    for (const w of day.windows) {
      const wStart = Date.parse(w.start);
      const wEnd = Date.parse(w.end);
      // SGT offset is a multiple of 30 min, so epoch rounding lands on :00/:30.
      for (let s = Math.ceil(wStart / step) * step; s + dur <= wEnd; s += step) {
        if (picked.length >= max) return picked;
        if (count >= perDay) break;
        picked.push({ start: toSgtIso(s), end: toSgtIso(s + dur) });
        count++;
      }
      if (count >= perDay) break;
    }
  }
  return picked;
}

export function isSlotFree(
  busy: BusyInterval[],
  startMs: number,
  endMs: number,
  nowMs: number
): boolean {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  if (startMs < nowMs) return false;
  if (endMs <= startMs) return false;
  const date = sgtDate(startMs);
  if (
    startMs < sgtHourMs(date, GUEST_RULES.startHour) ||
    endMs > sgtHourMs(date, GUEST_RULES.endHour)
  ) {
    return false;
  }
  if (date > addDays(sgtDate(nowMs), GUEST_RULES.horizonDays)) return false;
  const pad = GUEST_RULES.paddingMin * MIN_MS;
  return !busy.some((b) => startMs < b.end + pad && endMs > b.start - pad);
}
