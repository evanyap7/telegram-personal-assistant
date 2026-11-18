export type FriendStatus = "pending" | "approved" | "blocked";
export type BookingStatus =
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "failed";

export interface Friend {
  telegramUserId: number;
  displayName: string;
  username: string | null;
  status: FriendStatus;
  firstSeenAt: string;
  lastOwnerPingAt: string | null;
}

export interface BookingRequest {
  id: string;
  friendId: number;
  start: string;
  end: string;
  note: string;
  status: BookingStatus;
  createdAt: string;
}

export interface GuestStore {
  getFriend(id: number): Promise<Friend | null>;
  createPendingFriend(i: {
    telegramUserId: number;
    displayName: string;
    username: string | null;
  }): Promise<Friend>;
  setFriendStatus(id: number, status: FriendStatus): Promise<void>;
  markOwnerPinged(id: number, atIso: string): Promise<void>;
  countPendingFriends(): Promise<number>;
  createBooking(i: {
    friendId: number;
    start: string;
    end: string;
    note: string;
  }): Promise<BookingRequest>;
  getBooking(id: string): Promise<BookingRequest | null>;
  /** True only if the booking's status was `from` (and is now `to`). */
  transitionBooking(
    id: string,
    from: BookingStatus,
    to: BookingStatus
  ): Promise<boolean>;
  /** Bookings with status "pending" for this friend. */
  listOpenBookings(friendId: number): Promise<BookingRequest[]>;
  /** Pending bookings created before `olderThanIso`. */
  listStalePending(olderThanIso: string): Promise<BookingRequest[]>;
  /** Fixed one-hour window rate limit; true if the message is allowed. */
  takeMessageSlot(
    friendId: number,
    nowMs: number,
    limitPerHour: number
  ): Promise<boolean>;
}

export const RATE_WINDOW_MS = 3_600_000;

export function newBookingId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
