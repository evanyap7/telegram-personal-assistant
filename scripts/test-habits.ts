import assert from "node:assert/strict";
import { formatHabitsSummary, type HabitItem } from "../lib/habits";

async function runHabitTests() {
  console.log("\n=======================================================");
  console.log("  🔥 Habit Tracking & Streak Engine Unit Tests");
  console.log("=======================================================\n");

  // 1. Empty habit list
  console.log("Test 1: Empty habit list...");
  const emptySummary = formatHabitsSummary([]);
  assert.match(emptySummary.text, /No habits tracked yet/);
  assert.equal(emptySummary.buttons.length, 0);
  console.log("  ✅ Empty habit list handled gracefully.\n");

  // 2. Active habits with streak formatting
  console.log("Test 2: Formatting habits with streaks...");
  const mockHabits: HabitItem[] = [
    {
      rowNumber: 2,
      habitId: "h_read",
      name: "Read 20 mins",
      frequency: "daily",
      lastCompletedDate: "2026-10-23",
      currentStreak: 5,
      bestStreak: 12,
      createdAt: "2026-10-01",
    },
    {
      rowNumber: 3,
      habitId: "h_water",
      name: "Drink 2L Water",
      frequency: "daily",
      lastCompletedDate: "2026-10-22",
      currentStreak: 3,
      bestStreak: 7,
      createdAt: "2026-10-01",
    },
  ];

  const summary = formatHabitsSummary(mockHabits);
  assert.match(summary.text, /Read 20 mins/);
  assert.match(summary.text, /Drink 2L Water/);
  assert.match(summary.text, /Progress:/);
  assert.ok(summary.buttons.length > 0, "Should generate pending check-off buttons");
  assert.equal(summary.buttons[0][0].callback_data, "habit_done:h_water");
  console.log("  ✅ Habits summary and check-off buttons formatted accurately.\n");

  console.log("🎉 All Habit Tracking unit tests passed!\n");
}

runHabitTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
