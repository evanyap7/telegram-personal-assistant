import { getSheetsClient, withExponentialBackoff } from "../google";
import {
  newBookingId,
  RATE_WINDOW_MS,
  type BookingRequest,
  type BookingStatus,
  type Friend,
  type FriendStatus,
  type GuestStore,
} from "./types";

// Not unit-tested offline: it needs the Google Sheets API (no network in `npm run check`).
// The memory store in ./memory-store.ts is the tested reference for these semantics.

const FRIENDS = "Friends";
const BOOKINGS = "BookingRequests";
const RATE = "GuestRate";

const HEADERS: Record<string, string[]> = {
  [FRIENDS]: [
    "telegramUserId",
    "displayName",
    "username",
    "status",
    "firstSeenAt",
    "lastOwnerPingAt",
  ],
  [BOOKINGS]: ["id", "friendId", "start", "end", "note", "status", "createdAt"],
  [RATE]: ["friendId", "windowStartMs", "count"],
};

const LAST_COL: Record<string, string> = {
  [FRIENDS]: "F",
  [BOOKINGS]: "G",
  [RATE]: "C",
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

// Tabs already verified/created in this process.
const ensuredTabs = new Set<string>();

async function ensureTab(tab: string): Promise<void> {
  if (ensuredTabs.has(tab)) return;
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await withExponentialBackoff(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties(title)",
    })
  );
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tab);

  if (!exists) {
    await withExponentialBackoff(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
      })
    );
    await withExponentialBackoff(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tab}!A1:${LAST_COL[tab]}1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADERS[tab]] },
      })
    );
  }
  ensuredTabs.add(tab);
}

async function readRows(tab: string): Promise<string[][]> {
  await ensureTab(tab);
  const response = await withExponentialBackoff(() =>
    getSheetsClient().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `${tab}!A2:${LAST_COL[tab]}`,
    })
  );
  return (response.data.values ?? []) as string[][];
}

async function appendRow(tab: string, row: (string | number)[]): Promise<void> {
  await ensureTab(tab);
  await withExponentialBackoff(() =>
    getSheetsClient().spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `${tab}!A:${LAST_COL[tab]}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    })
  );
}

async function writeRow(
  tab: string,
  rowNumber: number,
  row: (string | number)[]
): Promise<void> {
  await withExponentialBackoff(() =>
    getSheetsClient().spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${tab}!A${rowNumber}:${LAST_COL[tab]}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    })
  );
}

function friendToRow(f: Friend): (string | number)[] {
  return [
    f.telegramUserId,
    f.displayName,
    f.username ?? "",
    f.status,
    f.firstSeenAt,
    f.lastOwnerPingAt ?? "",
  ];
}

function rowToFriend(row: string[]): Friend {
  return {
    telegramUserId: Number(row[0]),
    displayName: row[1] ?? "",
    username: row[2] ? row[2] : null,
    status: (row[3] ?? "pending") as FriendStatus,
    firstSeenAt: row[4] ?? "",
    lastOwnerPingAt: row[5] ? row[5] : null,
  };
}

function bookingToRow(b: BookingRequest): (string | number)[] {
  return [b.id, b.friendId, b.start, b.end, b.note, b.status, b.createdAt];
}

function rowToBooking(row: string[]): BookingRequest {
  return {
    id: row[0] ?? "",
    friendId: Number(row[1]),
    start: row[2] ?? "",
    end: row[3] ?? "",
    note: row[4] ?? "",
    status: (row[5] ?? "pending") as BookingStatus,
    createdAt: row[6] ?? "",
  };
}

async function findFriend(
  id: number
): Promise<{ friend: Friend; rowNumber: number } | null> {
  const rows = await readRows(FRIENDS);
  const index = rows.findIndex((r) => Number(r[0]) === id);
  if (index === -1) return null;
  return { friend: rowToFriend(rows[index]), rowNumber: index + 2 };
}

async function findBooking(
  id: string
): Promise<{ booking: BookingRequest; rowNumber: number } | null> {
  const rows = await readRows(BOOKINGS);
  const index = rows.findIndex((r) => r[0] === id);
  if (index === -1) return null;
  return { booking: rowToBooking(rows[index]), rowNumber: index + 2 };
}

export function createSheetsStore(): GuestStore {
  return {
    async getFriend(id) {
      return (await findFriend(id))?.friend ?? null;
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
      await appendRow(FRIENDS, friendToRow(friend));
      return friend;
    },

    async setFriendStatus(id, status) {
      const found = await findFriend(id);
      if (!found) return;
      await writeRow(FRIENDS, found.rowNumber, friendToRow({ ...found.friend, status }));
    },

    async markOwnerPinged(id, atIso) {
      const found = await findFriend(id);
      if (!found) return;
      await writeRow(
        FRIENDS,
        found.rowNumber,
        friendToRow({ ...found.friend, lastOwnerPingAt: atIso })
      );
    },

    async countPendingFriends() {
      const rows = await readRows(FRIENDS);
      return rows.filter((r) => r[3] === "pending").length;
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
      await appendRow(BOOKINGS, bookingToRow(booking));
      return booking;
    },

    async getBooking(id) {
      return (await findBooking(id))?.booking ?? null;
    },

    // Read-compare-write: known non-atomic, acceptable for a single-owner approval flow.
    async transitionBooking(id, from, to) {
      const found = await findBooking(id);
      if (!found || found.booking.status !== from) return false;
      await writeRow(
        BOOKINGS,
        found.rowNumber,
        bookingToRow({ ...found.booking, status: to })
      );
      return true;
    },

    async listOpenBookings(friendId) {
      const rows = await readRows(BOOKINGS);
      return rows
        .map(rowToBooking)
        .filter((b) => b.friendId === friendId && b.status === "pending");
    },

    async listStalePending(olderThanIso) {
      const cutoff = new Date(olderThanIso).getTime();
      const rows = await readRows(BOOKINGS);
      return rows
        .map(rowToBooking)
        .filter(
          (b) =>
            b.status === "pending" && new Date(b.createdAt).getTime() < cutoff
        );
    },

    async takeMessageSlot(friendId, nowMs, limitPerHour) {
      const rows = await readRows(RATE);
      const index = rows.findIndex((r) => Number(r[0]) === friendId);

      if (index === -1) {
        await appendRow(RATE, [friendId, nowMs, 1]);
        return true;
      }

      const rowNumber = index + 2;
      const windowStartMs = Number(rows[index][1]);
      const count = Number(rows[index][2]);

      if (Number.isNaN(windowStartMs) || nowMs - windowStartMs >= RATE_WINDOW_MS) {
        await writeRow(RATE, rowNumber, [friendId, nowMs, 1]);
        return true;
      }
      if (count < limitPerHour) {
        await writeRow(RATE, rowNumber, [friendId, windowStartMs, count + 1]);
        return true;
      }
      return false;
    },
  };
}
