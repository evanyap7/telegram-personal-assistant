/**
 * Unit tests for the friend scheduling (guest mode) store, against the
 * in-memory fake. The Sheets store is not tested offline (no network).
 *
 * Usage:
 *   npm run test:guest
 */

import { createMemoryStore } from "../lib/guest/memory-store";

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    totalFailed++;
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: Friend Scheduling Store");
  console.log("=======================================================\n");

  // Friends
  {
    const store = createMemoryStore();
    assert((await store.getFriend(1)) === null, "unknown friend is null");
    const created = await store.createPendingFriend({
      telegramUserId: 1,
      displayName: "Sam",
      username: null,
    });
    assert(created.status === "pending", "createPendingFriend returns pending");
    const got = await store.getFriend(1);
    assert(got?.status === "pending" && got.displayName === "Sam", "getFriend returns created friend");
    assert(got?.username === null && got?.lastOwnerPingAt === null, "nullable fields stay null");

    await store.setFriendStatus(1, "approved");
    assert((await store.getFriend(1))?.status === "approved", "setFriendStatus persists");

    await store.createPendingFriend({ telegramUserId: 2, displayName: "Al", username: "al" });
    await store.createPendingFriend({ telegramUserId: 3, displayName: "Bo", username: null });
    assert((await store.countPendingFriends()) === 2, "countPendingFriends counts only pending");

    await store.markOwnerPinged(2, "2026-11-19T10:00:00.000Z");
    assert(
      (await store.getFriend(2))?.lastOwnerPingAt === "2026-11-19T10:00:00.000Z",
      "markOwnerPinged persists"
    );
  }

  // Bookings
  {
    const store = createMemoryStore();
    const b = await store.createBooking({
      friendId: 1,
      start: "2026-11-20T10:00:00+08:00",
      end: "2026-11-20T11:00:00+08:00",
      note: "coffee",
    });
    assert(/^[0-9a-f]{12}$/.test(b.id) && b.status === "pending", "booking has 12-hex id and pending status");
    assert((await store.getBooking(b.id))?.note === "coffee", "getBooking returns booking");
    assert((await store.getBooking("nope")) === null, "unknown booking is null");

    assert((await store.transitionBooking(b.id, "pending", "approved")) === true, "transition pending->approved true");
    assert((await store.transitionBooking(b.id, "pending", "approved")) === false, "second identical transition false");
    assert((await store.transitionBooking(b.id, "declined", "approved")) === false, "wrong-from transition false");
    assert((await store.getBooking(b.id))?.status === "approved", "wrong-from leaves status unchanged");
  }

  {
    const store = createMemoryStore();
    const a = await store.createBooking({ friendId: 1, start: "s", end: "e", note: "" });
    const b = await store.createBooking({ friendId: 1, start: "s", end: "e", note: "" });
    await store.createBooking({ friendId: 2, start: "s", end: "e", note: "" });
    await store.transitionBooking(b.id, "pending", "declined");
    const open = await store.listOpenBookings(1);
    assert(open.length === 1 && open[0].id === a.id, "listOpenBookings excludes non-pending and other friends");

    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    assert((await store.listStalePending(future)).length === 2, "listStalePending returns pending older than iso");
    assert((await store.listStalePending(past)).length === 0, "listStalePending excludes newer bookings");
  }

  // Rate limit
  {
    const store = createMemoryStore();
    const t = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (await store.takeMessageSlot(7, t, 30)) allowed++;
    assert(allowed === 30, "takeMessageSlot allows 30 messages");
    assert((await store.takeMessageSlot(7, t, 30)) === false, "31st message blocked");
    assert((await store.takeMessageSlot(8, t, 30)) === true, "other friend unaffected");
    assert((await store.takeMessageSlot(7, t + 61 * 60_000, 30)) === true, "allowed again 61 minutes later");
  }

  console.log(`\nResults: ${totalPassed} passed, ${totalFailed} failed.`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
