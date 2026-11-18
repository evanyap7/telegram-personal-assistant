import type { InlineKeyboardMarkup } from "../telegram";
import type { TelegramUpdate } from "../telegram-types";
import type { Friend, GuestStore } from "./types";
import {
  GUEST_RULES,
  computeGuestWindows,
  isSlotFree,
  pickCandidateSlots,
  type BusyInterval,
  type DayWindows,
  type Slot,
} from "./slots";
import type { GuestIntent } from "./intent";
import { notifyOwnerOfBooking } from "./owner-actions";
import { COPY, formatDateLabel, formatSlotLabel, formatTimeRange, ownerPingText } from "./copy";

export interface GuestDeps {
  store: GuestStore;
  ownerId: number;
  now: () => number;
  send: (chatId: number, text: string, markup?: InlineKeyboardMarkup) => Promise<void>;
  answerCallback: (callbackId: string, text?: string) => Promise<void>;
  clearKeyboard: (chatId: number, messageId: number) => Promise<void>;
  getBusy: (fromDate: string, toDate: string) => Promise<BusyInterval[]>;
  parse: (text: string, todayDate: string) => Promise<GuestIntent>;
  createEvent: (i: { title: string; start: string; end: string }) => Promise<void>;
}

const SGT_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_PENDING_FRIENDS = 20;
const MAX_OPEN_BOOKINGS = 3;
const MESSAGES_PER_HOUR = 30;
const REPING_MS = 24 * 3_600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sgtDate(ms: number): string {
  return new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 10);
}
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
function toSgtIso(ms: number): string {
  return new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 19) + "+08:00";
}

export function sanitizeDisplayName(firstName?: string, username?: string): string {
  const clean = (v?: string) => (v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, 64).trim();
  return clean(firstName) || clean(username) || "Friend";
}

function windowsText(days: DayWindows[]): string {
  return days
    .map((d) => {
      const parts = d.windows.map((w) => formatTimeRange(Date.parse(w.start), Date.parse(w.end)));
      return `${formatDateLabel(d.date)}: ${parts.length ? parts.join(", ") : COPY.nothingFree}`;
    })
    .join("\n");
}

function slotButtons(slots: Slot[], durationMin: number): InlineKeyboardMarkup | undefined {
  if (slots.length === 0) return undefined;
  return {
    inline_keyboard: slots.map((s) => [
      { text: formatSlotLabel(s), callback_data: `g:r:${Math.floor(Date.parse(s.start) / 1000)}:${durationMin}` },
    ]),
  };
}

async function showAvailability(
  deps: GuestDeps,
  chatId: number,
  i: { fromDate: string; toDate: string; durationMin: number; partOfDay?: "morning" | "afternoon" | "evening" },
  prefix: string
): Promise<void> {
  const nowMs = deps.now();
  const busy = await deps.getBusy(i.fromDate, i.toDate);
  const days = computeGuestWindows({
    busy,
    fromDate: i.fromDate,
    toDate: i.toDate,
    partOfDay: i.partOfDay,
    durationMin: i.durationMin,
    nowMs,
  });
  const slots = pickCandidateSlots(days, i.durationMin);
  const body = days.length ? windowsText(days) : COPY.noneToOffer;
  await deps.send(chatId, prefix + body, slotButtons(slots, i.durationMin));
}

async function requestSlot(
  deps: GuestDeps,
  friend: Friend,
  chatId: number,
  startMs: number,
  durationMin: number,
  note: string
): Promise<void> {
  const open = await deps.store.listOpenBookings(friend.telegramUserId);
  if (open.length >= MAX_OPEN_BOOKINGS) {
    await deps.send(chatId, COPY.tooManyOpen);
    return;
  }
  const nowMs = deps.now();
  const today = sgtDate(nowMs);
  const maxDate = addDays(today, GUEST_RULES.horizonDays);
  const endMs = startMs + durationMin * 60_000;
  const valid = Number.isFinite(startMs) && Number.isFinite(endMs);
  const reqDate = valid ? sgtDate(startMs) : "";
  const inRange = DATE_RE.test(reqDate) && reqDate >= today && reqDate <= maxDate;
  const from = inRange ? reqDate : today;
  const to = inRange ? reqDate : addDays(today, 6);

  const busy = await deps.getBusy(from, to);
  if (valid && inRange && isSlotFree(busy, startMs, endMs, nowMs)) {
    const booking = await deps.store.createBooking({
      friendId: friend.telegramUserId,
      start: toSgtIso(startMs),
      end: toSgtIso(endMs),
      note,
    });
    try {
      await notifyOwnerOfBooking(deps, friend, booking);
    } catch (err) {
      console.error("guest: owner notify failed:", err instanceof Error ? err.message : "unknown");
      await deps.store.transitionBooking(booking.id, "pending", "failed");
      await deps.send(chatId, COPY.retry);
      return;
    }
    await deps.send(chatId, COPY.sent);
    return;
  }

  const days = computeGuestWindows({ busy, fromDate: from, toDate: to, durationMin, nowMs });
  const slots = pickCandidateSlots(days, durationMin);
  const body = days.length ? windowsText(days) : COPY.noneToOffer;
  await deps.send(chatId, `${COPY.notFree}\n${body}`, slotButtons(slots, durationMin));
}

/** Strict `g:r:<startEpochSec>:<durMin>`; null if malformed. */
function parseSlotCallback(data: string): { startMs: number; durationMin: number } | null {
  const m = /^g:r:(\d{1,12}):(\d{1,3})$/.exec(data);
  if (!m) return null;
  const sec = Number(m[1]);
  const dur = Number(m[2]);
  if (!Number.isSafeInteger(sec) || !Number.isInteger(dur) || dur < 15 || dur > 240) return null;
  return { startMs: sec * 1000, durationMin: dur };
}

async function handleStranger(deps: GuestDeps, chatId: number, userId: number, from: { first_name?: string; username?: string }): Promise<void> {
  if ((await deps.store.countPendingFriends()) >= MAX_PENDING_FRIENDS) {
    await deps.send(chatId, COPY.busyTryLater);
    return;
  }
  const friend = await deps.store.createPendingFriend({
    telegramUserId: userId,
    displayName: sanitizeDisplayName(from.first_name, from.username),
    username: from.username ?? null,
  });
  await deps.send(chatId, COPY.waiting);
  await pingOwner(deps, friend);
}

async function pingOwner(deps: GuestDeps, friend: Friend): Promise<void> {
  const id = friend.telegramUserId;
  await deps.send(deps.ownerId, ownerPingText(friend.displayName, friend.username), {
    inline_keyboard: [
      [
        { text: "Allow", callback_data: `g:allow:${id}` },
        { text: "Block", callback_data: `g:block:${id}` },
      ],
    ],
  });
  await deps.store.markOwnerPinged(id, new Date(deps.now()).toISOString());
}

async function handleBody(update: TelegramUpdate, deps: GuestDeps): Promise<void> {
  const cbq = update.callback_query;
  const m = update.message;
  const from = cbq?.from ?? m?.from;
  if (!from) return;
  const userId = from.id;
  const chatId = cbq ? cbq.message.chat.id : m!.chat.id;

  const friend = await deps.store.getFriend(userId);
  if (friend?.status === "blocked") {
    if (cbq) await deps.answerCallback(cbq.id);
    return;
  }

  if (cbq) {
    await deps.answerCallback(cbq.id);
    const req = friend?.status === "approved" ? parseSlotCallback(cbq.data ?? "") : null;
    if (!friend || !req) return;
    if (!(await deps.store.takeMessageSlot(userId, deps.now(), MESSAGES_PER_HOUR))) {
      await deps.send(chatId, COPY.slowDown);
      return;
    }
    await requestSlot(deps, friend, chatId, req.startMs, req.durationMin, "");
    return;
  }

  const text = m?.text?.trim();
  if (!text) {
    await deps.send(chatId, COPY.nonText);
    return;
  }

  if (!friend) {
    await handleStranger(deps, chatId, userId, from);
    return;
  }

  if (friend.status === "pending") {
    await deps.send(chatId, COPY.stillWaiting);
    const last = friend.lastOwnerPingAt ? Date.parse(friend.lastOwnerPingAt) : NaN;
    if (Number.isNaN(last) || deps.now() - last > REPING_MS) await pingOwner(deps, friend);
    return;
  }

  // approved
  if (!(await deps.store.takeMessageSlot(userId, deps.now(), MESSAGES_PER_HOUR))) {
    await deps.send(chatId, COPY.slowDown);
    return;
  }
  const intent = await deps.parse(text, sgtDate(deps.now()));
  if (intent.intent === "availability") {
    await showAvailability(
      deps,
      chatId,
      { fromDate: intent.dateFrom, toDate: intent.dateTo, durationMin: intent.durationMin, partOfDay: intent.partOfDay },
      ""
    );
  } else if (intent.intent === "request_slot") {
    await requestSlot(deps, friend, chatId, Date.parse(intent.requestedStart), intent.durationMin, intent.note);
  } else {
    await deps.send(chatId, COPY.help);
  }
}

/** Handles every non-owner update. Never throws. */
export async function handleGuestUpdate(update: TelegramUpdate, deps: GuestDeps): Promise<void> {
  try {
    await handleBody(update, deps);
  } catch (err) {
    console.error("guest handler error:", err instanceof Error ? err.message : "unknown");
    const chatId = update.callback_query?.message.chat.id ?? update.message?.chat.id;
    if (chatId === undefined) return;
    try {
      await deps.send(chatId, COPY.retry);
    } catch {
      /* nothing more to do */
    }
  }
}
