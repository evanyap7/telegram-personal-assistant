import type { GuestDeps } from "./handler";
import type { BookingRequest, Friend } from "./types";
import { isSlotFree } from "./slots";
import { clearBlocked, markBlocked } from "./throttle";
import { COPY, confirmedText, expiredFriendText, expiredOwnerText, formatSlotLabel } from "./copy";

const SGT_OFFSET_MS = 8 * 3_600_000;
const EXPIRY_MS = 24 * 3_600_000;
const ALREADY = "Already handled";

function bookingLabel(b: BookingRequest): string {
  return formatSlotLabel({ start: b.start, end: b.end });
}

function sgtDateOf(iso: string): string {
  return new Date(Date.parse(iso) + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Best-effort send to a friend; a failure must not undo owner decisions. */
async function tell(deps: GuestDeps, chatId: number, text: string): Promise<void> {
  try {
    await deps.send(chatId, text);
  } catch (err) {
    console.error("guest: send failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** Tells the owner about a new booking request, with Approve/Decline buttons. Plain text. */
export async function notifyOwnerOfBooking(
  deps: GuestDeps,
  friend: Friend,
  booking: BookingRequest
): Promise<void> {
  const note = booking.note ? ` Note: ${booking.note}` : "";
  await deps.send(deps.ownerId, `${friend.displayName} wants ${bookingLabel(booking)}.${note}`, {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `g:ok:${booking.id}` },
        { text: "Decline", callback_data: `g:no:${booking.id}` },
      ],
    ],
  });
}

async function setFriend(
  deps: GuestDeps,
  userId: number,
  target: "approved" | "blocked"
): Promise<string> {
  const friend = await deps.store.getFriend(userId);
  if (!friend || friend.status === target) return ALREADY;
  await deps.store.setFriendStatus(userId, target);
  if (target === "blocked") markBlocked(userId, deps.now());
  else clearBlocked(userId);
  if (target === "approved") {
    await tell(deps, userId, COPY.allowed);
    return "Allowed";
  }
  return "Blocked";
}

async function approve(deps: GuestDeps, bookingId: string): Promise<string> {
  const booking = await deps.store.getBooking(bookingId);
  if (!booking) return ALREADY;

  // The cleanup cron is daily, so a pending request can outlive its 24h window.
  const nowMs = deps.now();
  const createdMs = Date.parse(booking.createdAt);
  if (
    booking.status === "pending" &&
    ((Number.isFinite(createdMs) && nowMs - createdMs > EXPIRY_MS) || Date.parse(booking.start) <= nowMs)
  ) {
    if (await deps.store.transitionBooking(bookingId, "pending", "expired")) {
      const friend = await deps.store.getFriend(booking.friendId);
      if (friend?.status !== "blocked") await tell(deps, booking.friendId, expiredFriendText(bookingLabel(booking)));
    }
    return ALREADY;
  }

  if (!(await deps.store.transitionBooking(bookingId, "pending", "approved"))) return ALREADY;

  // Claimed: every failure from here on must end in approved -> failed.
  const fail = async (ownerText: string, friendText: string): Promise<string> => {
    try {
      await deps.store.transitionBooking(bookingId, "approved", "failed");
    } catch (err) {
      console.error("guest: failed-transition error:", err instanceof Error ? err.message : "unknown");
    }
    await tell(deps, deps.ownerId, ownerText);
    await tell(deps, booking.friendId, friendText);
    return ownerText;
  };

  try {
    const friend = await deps.store.getFriend(booking.friendId);
    const name = friend?.displayName ?? "Friend";
    const label = bookingLabel(booking);
    const startMs = Date.parse(booking.start);
    const endMs = Date.parse(booking.end);
    const date = sgtDateOf(booking.start);
    let free: boolean;
    try {
      free = isSlotFree(await deps.getBusy(date, date), startMs, endMs, deps.now());
    } catch (err) {
      console.error("guest: busy check failed:", err instanceof Error ? err.message : "unknown");
      return await fail("Couldn't check the calendar", COPY.retry);
    }
    if (!free) {
      return await fail(`That slot for ${name} is no longer free.`, COPY.slotTaken);
    }
    try {
      await deps.createEvent({ title: `Meet ${name}`, start: booking.start, end: booking.end });
    } catch (err) {
      console.error("guest: createEvent failed:", err instanceof Error ? err.message : "unknown");
      return await fail("Couldn't add it to the calendar", COPY.retry);
    }
    await tell(deps, booking.friendId, confirmedText(label));
    return "Approved";
  } catch (err) {
    console.error("guest: approve failed:", err instanceof Error ? err.message : "unknown");
    return fail("Couldn't approve that request", COPY.retry);
  }
}

async function decline(deps: GuestDeps, bookingId: string): Promise<string> {
  const booking = await deps.store.getBooking(bookingId);
  if (!booking || !(await deps.store.transitionBooking(bookingId, "pending", "declined"))) return ALREADY;
  const friend = await deps.store.getFriend(booking.friendId);
  if (friend?.status !== "blocked") await tell(deps, booking.friendId, COPY.declined);
  return "Declined";
}

/** Handles owner taps on g:allow|block|ok|no buttons. Never throws. */
export async function handleOwnerCallback(
  i: { data: string; userId: number; callbackId: string; chatId: number; messageId: number },
  deps: GuestDeps
): Promise<void> {
  try {
    if (i.userId !== deps.ownerId) {
      await deps.answerCallback(i.callbackId, "Not allowed");
      return;
    }
    const m = /^g:(allow|block|ok|no):([A-Za-z0-9_-]{1,64})$/.exec(i.data);
    let answer = ALREADY;
    if (m) {
      const [, action, arg] = m;
      if (action === "allow" || action === "block") {
        const uid = Number(arg);
        if (Number.isSafeInteger(uid)) answer = await setFriend(deps, uid, action === "allow" ? "approved" : "blocked");
      } else if (action === "ok") {
        answer = await approve(deps, arg);
      } else {
        answer = await decline(deps, arg);
      }
    }
    await deps.answerCallback(i.callbackId, answer);
    try {
      await deps.clearKeyboard(i.chatId, i.messageId);
    } catch (err) {
      console.error("guest: clearKeyboard failed:", err instanceof Error ? err.message : "unknown");
    }
  } catch (err) {
    console.error("guest owner callback error:", err instanceof Error ? err.message : "unknown");
    try {
      await deps.answerCallback(i.callbackId, COPY.retry);
    } catch {
      /* nothing more to do */
    }
  }
}

/** Expires pending bookings older than 24h. Returns the count expired. Never throws. */
export async function expireStaleBookings(deps: GuestDeps): Promise<number> {
  let stale: BookingRequest[];
  try {
    stale = await deps.store.listStalePending(new Date(deps.now() - EXPIRY_MS).toISOString());
  } catch (err) {
    console.error("guest: expiry list failed:", err instanceof Error ? err.message : "unknown");
    return 0;
  }
  let count = 0;
  for (const b of stale) {
    try {
      if (!(await deps.store.transitionBooking(b.id, "pending", "expired"))) continue;
      count++;
      const label = bookingLabel(b);
      const friend = await deps.store.getFriend(b.friendId);
      if (friend?.status !== "blocked") await tell(deps, b.friendId, expiredFriendText(label));
      await tell(deps, deps.ownerId, expiredOwnerText(friend?.displayName ?? "Friend", label));
    } catch (err) {
      console.error("guest: expiry failed:", err instanceof Error ? err.message : "unknown");
    }
  }
  return count;
}
