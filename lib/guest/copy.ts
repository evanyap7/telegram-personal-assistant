import type { Slot } from "./slots";

export const OWNER_NAME = "Evan";

export const COPY = {
  waiting: "Waiting for approval. I'll let you know once it's sorted.",
  stillWaiting: "Still waiting for approval, hang tight.",
  busyTryLater: "I'm a bit busy right now, try again later.",
  nonText: "I can only read text messages.",
  slowDown: "Slow down a little, try again in a bit.",
  retry: "Couldn't check right now, try again later",
  tooManyOpen: "You already have a few requests waiting. Let's wait for those first.",
  notFree: "Sorry, that time isn't free.",
  sent: "Sent — I'll let you know",
  help: `I can show when ${OWNER_NAME} is free and send a request — try 'free Thursday evening?'`,
  nothingFree: "nothing free",
  noneToOffer: "Nothing free in that range.",
  allowed: `You're in — ask me when ${OWNER_NAME} is free`,
  declined: "That time doesn't work — want to try another?",
  slotTaken: "Sorry, that slot just got taken, want to pick another?",
} as const;

const SGT_OFFSET_MS = 8 * 3_600_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sgt(ms: number): Date {
  return new Date(ms + SGT_OFFSET_MS);
}

/** "Thu 19 Nov" for an epoch ms, in SGT. */
export function formatDayLabel(ms: number): string {
  const d = sgt(ms);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function clock(ms: number): { h: number; m: number; ap: "AM" | "PM" } {
  const d = sgt(ms);
  const h24 = d.getUTCHours();
  return { h: h24 % 12 === 0 ? 12 : h24 % 12, m: d.getUTCMinutes(), ap: h24 < 12 ? "AM" : "PM" };
}

/** "3:00–4:00 PM" (or "11:30 AM–12:30 PM" across noon), in SGT. */
export function formatTimeRange(startMs: number, endMs: number): string {
  const a = clock(startMs);
  const b = clock(endMs);
  const t = (c: { h: number; m: number }) => `${c.h}:${String(c.m).padStart(2, "0")}`;
  return a.ap === b.ap ? `${t(a)}–${t(b)} ${b.ap}` : `${t(a)} ${a.ap}–${t(b)} ${b.ap}`;
}

/** e.g. "Thu 19 Nov, 3:00–4:00 PM". */
export function formatSlotLabel(slot: Slot): string {
  const s = Date.parse(slot.start);
  const e = Date.parse(slot.end);
  return `${formatDayLabel(s)}, ${formatTimeRange(s, e)}`;
}

export function formatDateLabel(date: string): string {
  return formatDayLabel(Date.parse(`${date}T12:00:00+08:00`));
}

export function ownerPingText(name: string, username: string | null): string {
  return `Allow ${name}${username ? ` (@${username})` : ""}?`;
}

export function confirmedText(label: string): string {
  return `Confirmed: ${label}`;
}

export function expiredFriendText(label: string): string {
  return `Your request for ${label} expired — want to pick another time?`;
}

export function expiredOwnerText(name: string, label: string): string {
  return `${name}'s request for ${label} expired.`;
}
