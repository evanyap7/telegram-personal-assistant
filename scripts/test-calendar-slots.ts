/**
 * Unit Test Suite for Calendar Free Slots Finder & Singapore Travel Buffers
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-calendar-slots.ts
 */

import {
  calculateFreeSlotsFromIntervals,
  formatFreeSlotsMessage,
} from "../lib/calendar";
import { estimateSingaporeTravelTime } from "../lib/travel";

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

function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: Calendar Free Slots & Travel Buffers");
  console.log("=======================================================\n");

  const baseDate = "2026-10-01";
  const dayStartMs = new Date(`${baseDate}T09:00:00+08:00`).getTime();
  const dayEndMs = new Date(`${baseDate}T21:00:00+08:00`).getTime(); // 12 hours = 720 mins

  // Test 1: Completely empty day
  {
    const slots = calculateFreeSlotsFromIntervals([], dayStartMs, dayEndMs, 30);
    assert(slots.length === 1, "Completely empty day produces 1 large free slot");
    assert(slots[0].durationMinutes === 720, "Slot duration is 720 minutes (12 hours)");
  }

  // Test 2: Completely busy day
  {
    const busy = [{ start: dayStartMs, end: dayEndMs }];
    const slots = calculateFreeSlotsFromIntervals(busy, dayStartMs, dayEndMs, 30);
    assert(slots.length === 0, "Completely busy day produces 0 free slots");
  }

  // Test 3: Single lunch meeting (12:00 PM to 1:00 PM)
  {
    const lunchStart = new Date(`${baseDate}T12:00:00+08:00`).getTime();
    const lunchEnd = new Date(`${baseDate}T13:00:00+08:00`).getTime();
    const slots = calculateFreeSlotsFromIntervals(
      [{ start: lunchStart, end: lunchEnd }],
      dayStartMs,
      dayEndMs,
      30
    );
    assert(slots.length === 2, "Lunch meeting splits day into morning and afternoon slots");
    assert(slots[0].durationMinutes === 180, "Morning slot is 3 hours (9 AM - 12 PM)");
    assert(slots[1].durationMinutes === 480, "Afternoon slot is 8 hours (1 PM - 9 PM)");
  }

  // Test 4: Overlapping busy meetings are properly merged
  {
    const m1Start = new Date(`${baseDate}T10:00:00+08:00`).getTime();
    const m1End = new Date(`${baseDate}T11:00:00+08:00`).getTime();
    const m2Start = new Date(`${baseDate}T10:30:00+08:00`).getTime();
    const m2End = new Date(`${baseDate}T11:30:00+08:00`).getTime();

    const slots = calculateFreeSlotsFromIntervals(
      [
        { start: m1Start, end: m1End },
        { start: m2Start, end: m2End },
      ],
      dayStartMs,
      dayEndMs,
      30
    );
    assert(slots.length === 2, "Overlapping meetings merged into single busy block");
    assert(slots[0].durationMinutes === 60, "Slot before meeting is 9 AM - 10 AM (60 mins)");
    assert(slots[1].durationMinutes === 570, "Slot after meeting is 11:30 AM - 9:00 PM (570 mins)");
  }

  // Test 5: Filter out slots shorter than minDurationMinutes
  {
    // Meeting from 9:00 to 9:45, and another from 10:00 to 21:00 -> 15 min gap between 9:45 and 10:00
    const m1Start = dayStartMs;
    const m1End = new Date(`${baseDate}T09:45:00+08:00`).getTime();
    const m2Start = new Date(`${baseDate}T10:00:00+08:00`).getTime();
    const m2End = dayEndMs;

    const slots30 = calculateFreeSlotsFromIntervals(
      [
        { start: m1Start, end: m1End },
        { start: m2Start, end: m2End },
      ],
      dayStartMs,
      dayEndMs,
      30
    );
    assert(slots30.length === 0, "15-minute gap ignored when minDuration is 30 mins");

    const slots15 = calculateFreeSlotsFromIntervals(
      [
        { start: m1Start, end: m1End },
        { start: m2Start, end: m2End },
      ],
      dayStartMs,
      dayEndMs,
      15
    );
    assert(slots15.length === 1, "15-minute gap included when minDuration is 15 mins");
  }

  // Test 6: formatFreeSlotsMessage
  {
    const emptyMsg = formatFreeSlotsMessage(baseDate, [], 4);
    assert(emptyMsg.includes("No free slots"), "Formats empty free slots message");

    const singleSlot = calculateFreeSlotsFromIntervals([], dayStartMs, dayEndMs, 30);
    const hasSlotsMsg = formatFreeSlotsMessage(baseDate, singleSlot, 0);
    assert(hasSlotsMsg.includes("Available Free Slots"), "Formats available slots message");
    assert(hasSlotsMsg.includes("🟢"), "Includes green indicator bullet");
  }

  // Test 7: Singapore Travel Heuristics
  {
    const zoomEst = estimateSingaporeTravelTime("Zoom call with team");
    assert(zoomEst.travelMinutes === 0, "Virtual/Zoom call has 0 travel minutes");
    assert(zoomEst.bufferMinutes === 2, "Virtual call has 2 min buffer");

    const changiEst = estimateSingaporeTravelTime("Terminal 3, Changi Airport");
    assert(changiEst.travelMinutes === 45, "Changi airport estimated at 45 minutes transit");
    assert(changiEst.totalLeadMinutes === 55, "Total lead time is 55 mins (45 + 10 buffer)");

    const cbdEst = estimateSingaporeTravelTime("Marina Bay Financial Centre");
    assert(cbdEst.travelMinutes === 25, "CBD / MBFC estimated at 25 minutes transit");

    const nusEst = estimateSingaporeTravelTime("NUS UTown Auditorium");
    assert(nusEst.travelMinutes === 40, "NUS estimated at 40 minutes transit");

    const walkEst = estimateSingaporeTravelTime("Nearby coffee shop down the block");
    assert(walkEst.travelMinutes === 10, "Nearby walk estimated at 10 minutes");
    assert(walkEst.transitMode === "walk", "Transit mode is walk");
  }

  console.log(`\nResults: ${totalPassed} passed, ${totalFailed} failed.`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
