import assert from "node:assert/strict";
import {
  describeTarget,
  isEndWorkoutCommand,
  isSkipExerciseCommand,
  isSkipSetCommand,
  isWorkoutStartPhrase,
  parseSetInput,
  parseWorkoutDayCommand,
} from "../lib/workout/workout-session";
import { columnToA1, formatSheetEntry, getBlockInfo } from "../lib/workout/ph3-program";

function run() {
  console.log("\n  🏋️ Guided PH3 Workout Session Tests\n");

  // Set parsing
  const accepted: Array<[string, number, number]> = [
    ["100 x 5", 100, 5],
    ["100x5", 100, 5],
    ["100 5", 100, 5],
    ["100kg 5", 100, 5],
    ["100 kg x 5 reps", 100, 5],
    ["102.5 for 6", 102.5, 6],
    ["45*8", 45, 8],
    ["bw x 10", 0, 10],
    ["Bodyweight 12", 0, 12],
    ["97,5 x 4", 97.5, 4],
  ];
  for (const [input, w, r] of accepted) {
    assert.deepEqual(parseSetInput(input), { weightKg: w, reps: r }, `parse "${input}"`);
  }
  for (const input of ["", "hello", "100", "x 5", "100 x", "100 x 0", "100 x 500", "2000 x 5", "remind me at 5"]) {
    assert.equal(parseSetInput(input), null, `reject "${input}"`);
  }
  console.log("  ✅ set parsing");

  // End / start phrases
  for (const t of ["end workout", "End", "stop", "cancel workout", "/endworkout", "finish workout", "I'm done", "im done.", "quit"]) {
    assert.ok(isEndWorkoutCommand(t), `end: ${t}`);
  }
  for (const t of ["100 x 5", "stop the music", "what's my balance"]) {
    assert.ok(!isEndWorkoutCommand(t), `not end: ${t}`);
  }
  for (const t of ["workout", "/gym", "i wanna work out", "I want to workout", "let's lift", "gym time", "start my workout"]) {
    assert.ok(isWorkoutStartPhrase(t), `start: ${t}`);
  }
  for (const t of ["add workout to calendar", "100 x 5", "how was my workout stats"]) {
    assert.ok(!isWorkoutStartPhrase(t), `not start: ${t}`);
  }
  console.log("  ✅ start / end phrases");

  // Day commands & skip / switch syntax
  assert.deepEqual(parseWorkoutDayCommand("lets skip day 1 and start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("let's skip day 1 and start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip day 1 and start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip day 1, start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip day 1 and do day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip day 1 & start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip today and start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
    fromDay: undefined,
  });
  assert.deepEqual(parseWorkoutDayCommand("start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
  });
  assert.deepEqual(parseWorkoutDayCommand("lets start day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
  });
  assert.deepEqual(parseWorkoutDayCommand("do day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
  });
  assert.deepEqual(parseWorkoutDayCommand("switch to day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip to day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
  });
  assert.deepEqual(parseWorkoutDayCommand("go to day 2"), {
    kind: "set",
    day: 2,
    startImmediately: true,
  });
  assert.deepEqual(parseWorkoutDayCommand("set workout day 12"), {
    kind: "set",
    day: 12,
    startImmediately: false,
  });
  assert.deepEqual(parseWorkoutDayCommand("/workoutday 40"), {
    kind: "set",
    day: 40,
    startImmediately: false,
  });
  assert.deepEqual(parseWorkoutDayCommand("next workout day"), {
    kind: "next",
    startImmediately: false,
  });
  assert.deepEqual(parseWorkoutDayCommand("next day"), {
    kind: "next",
    startImmediately: false,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip day 1"), {
    kind: "next",
    startImmediately: false,
    fromDay: 1,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip this day"), {
    kind: "next",
    startImmediately: false,
    fromDay: undefined,
  });
  assert.deepEqual(parseWorkoutDayCommand("skip today"), {
    kind: "next",
    startImmediately: false,
    fromDay: undefined,
  });
  console.log("  ✅ day commands");

  // Skip exercise / set
  for (const t of ["skip exercise", "Skip Exercise.", "skip this exercise", "next exercise", "next exercise!"]) {
    assert.ok(isSkipExerciseCommand(t), `skip ex: ${t}`);
  }
  for (const t of ["skip set", "Skip Set", "skip this set", "next set"]) {
    assert.ok(isSkipSetCommand(t), `skip set: ${t}`);
  }
  assert.ok(!isSkipExerciseCommand("100 x 5"));
  assert.ok(!isSkipSetCommand("100 x 5"));
  console.log("  ✅ skip exercise / set commands");

  // Target formatting
  assert.equal(describeTarget({ setNumber: 1, weight: "  95.0 ".trim(), reps: "x9", weightCell: "C10" }), "95kg × 9");
  assert.equal(describeTarget({ setNumber: 1, weight: "", reps: "x6-8", weightCell: "C15" }), "6-8 reps");
  console.log("  ✅ target formatting");

  // Sheet mapping helpers
  assert.equal(columnToA1(0), "A");
  assert.equal(columnToA1(2), "C");
  assert.equal(columnToA1(15), "P");
  assert.equal(columnToA1(26), "AA");
  assert.equal(formatSheetEntry(45, 8), "45*8");
  assert.equal(formatSheetEntry(102.5, 6), "102.5*6");
  assert.deepEqual(getBlockInfo(8), { tab: "Accumulation Block", week: 2, colOffset: 13 });
  assert.equal(getBlockInfo(29).tab, "Intermediate Block");
  assert.equal(getBlockInfo(90).tab, "Taper (Final Week)");
  console.log("  ✅ sheet cell mapping");

  console.log("\n  All workout session tests passed.\n");
}

run();
