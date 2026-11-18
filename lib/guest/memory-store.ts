import {
  newBookingId,
  RATE_WINDOW_MS,
  type BookingRequest,
  type Friend,
  type GuestStore,
} from "./types";

export function createMemoryStore(): GuestStore {
  const friends = new Map<number, Friend>();
  const bookings = new Map<string, BookingRequest>();
  const rates = new Map<number, { windowStartMs: number; count: number }>();

  return {
    async getFriend(id) {
      const f = friends.get(id);
      return f ? { ...f } : null;
    },
    async createPendingFriend(i) {
      const friend: Friend = {
        telegramUserId: i.telegramUserId,
        displayName: i.displayName,
        username: i.username,
        status: "pending",
        firstSeenAt: new Date().toISOString(),
        lastOwnerPingAt: null,
      };
      friends.set(friend.telegramUserId, friend);
      return { ...friend };
    },
    async setFriendStatus(id, status) {
      const f = friends.get(id);
      if (f) f.status = status;
    },
    async markOwnerPinged(id, atIso) {
      const f = friends.get(id);
      if (f) f.lastOwnerPingAt = atIso;
    },
    async countPendingFriends() {
      return [...friends.values()].filter((f) => f.status === "pending").length;
    },
    async createBooking(i) {
      const booking: BookingRequest = {
        id: newBookingId(),
        friendId: i.friendId,
        start: i.start,
        end: i.end,
        note: i.note,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      bookings.set(booking.id, booking);
      return { ...booking };
    },
    async getBooking(id) {
      const b = bookings.get(id);
      return b ? { ...b } : null;
    },
    async transitionBooking(id, from, to) {
      const b = bookings.get(id);
      if (!b || b.status !== from) return false;
      b.status = to;
      return true;
    },
    async listOpenBookings(friendId) {
      return [...bookings.values()]
        .filter((b) => b.friendId === friendId && b.status === "pending")
        .map((b) => ({ ...b }));
    },
    async listStalePending(olderThanIso) {
      const cutoff = new Date(olderThanIso).getTime();
      return [...bookings.values()]
        .filter(
          (b) =>
            b.status === "pending" && new Date(b.createdAt).getTime() < cutoff
        )
        .map((b) => ({ ...b }));
    },
    async takeMessageSlot(friendId, nowMs, limitPerHour) {
      const r = rates.get(friendId);
      if (!r || nowMs - r.windowStartMs >= RATE_WINDOW_MS) {
        rates.set(friendId, { windowStartMs: nowMs, count: 1 });
        return true;
      }
      if (r.count < limitPerHour) {
        r.count += 1;
        return true;
      }
      return false;
    },
  };
}
