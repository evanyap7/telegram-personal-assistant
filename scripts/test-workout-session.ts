import assert from "node:assert/strict";
import {
  describeTarget,
  findNextPending,
  getSetStatus,
  isEndWorkoutCommand,
  isSkipExerciseCommand,
  isSkipSetCommand,
  isWorkoutStartPhrase,
  parseSetInput,
  parseWorkoutDayCommand,
} from "../lib/workout/workout-session";
import { columnToA1, formatSheetReps, getBlockInfo } from "../lib/workout/ph3-program";

const plan = {
  day: 1,
  week: 1,
  blockTab: "Accumulation Block",
  dayTitle: "Day 1 Upper",
  isRestDay: false,
  exercises: [
    { exercise: "Bench", sets: [1, 2, 3].map((n) => ({ setNumber: n, weight: "", reps: "", weightCell: `A${n}`, repsCell: `B${n}` })) },
    { exercise: "Row", sets: [1, 2].map((n) => ({ setNumber: n, weight: "", reps: "", weightCell: `C${n}`, repsCell: `D${n}` })) },
  ],
};
const logged = (exercise: string, setNumber: number) => ({ exercise, setNumber, weightKg: 50, reps: 5, inSheet: true });

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
  assert.equal(describeTarget({ setNumber: 1, weight: "  95.0 ".trim(), reps: "x9", weightCell: "C10", repsCell: "D10" }), "95kg × 9");
  assert.equal(describeTarget({ setNumber: 1, weight: "", reps: "x6-8", weightCell: "C15", repsCell: "D15" }), "6-8 reps");
  console.log("  ✅ target formatting");

  // Sheet mapping helpers
  assert.equal(columnToA1(0), "A");
  assert.equal(columnToA1(2), "C");
  assert.equal(columnToA1(15), "P");
  assert.equal(columnToA1(26), "AA");
  assert.equal(formatSheetReps(8), "x8");
  assert.equal(formatSheetReps(12), "x12");
  assert.deepEqual(getBlockInfo(8), { tab: "Accumulation Block", week: 2, colOffset: 13 });
  assert.equal(getBlockInfo(29).tab, "Intermediate Block");
  assert.equal(getBlockInfo(90).tab, "Taper (Final Week)");
  console.log("  ✅ sheet cell mapping");

  // Set status + cursor logic
  const fresh = { logged: [], skipped: undefined };
  assert.deepEqual(findNextPending(plan, fresh, 0, 0), { exIdx: 0, setIdx: 0 });
  assert.equal(getSetStatus({ logged: [logged("Bench", 1)] }, "Bench", 1), "logged");
  assert.equal(getSetStatus({ logged: [], skipped: [{ exercise: "Bench", setNumber: 2 }] }, "Bench", 2), "skipped");
  assert.equal(getSetStatus(fresh, "Bench", 3), "pending");

  // Advances past logged and skipped sets, across exercises
  assert.deepEqual(
    findNextPending(plan, { logged: [logged("Bench", 1)], skipped: [{ exercise: "Bench", setNumber: 2 }] }, 0, 0),
    { exIdx: 0, setIdx: 2 }
  );
  assert.deepEqual(
    findNextPending(
      plan,
      { logged: [logged("Bench", 1)], skipped: [{ exercise: "Bench", setNumber: 2 }, { exercise: "Bench", setNumber: 3 }] },
      0,
      1
    ),
    { exIdx: 1, setIdx: 0 }
  );
  // Wraps around to an earlier set that was left undone
  assert.deepEqual(
    findNextPending(plan, { logged: [logged("Bench", 2), logged("Bench", 3), logged("Row", 1), logged("Row", 2)] }, 1, 1),
    { exIdx: 0, setIdx: 0 }
  );
  // Nothing left
  const everything = {
    logged: [logged("Bench", 1), logged("Bench", 3), logged("Row", 1)],
    skipped: [{ exercise: "Bench", setNumber: 2 }, { exercise: "Row", setNumber: 2 }],
  };
  assert.equal(findNextPending(plan, everything, 0, 0), null);
  console.log("  ✅ per-set status and cursor");

  console.log("\n  All workout session tests passed.\n");
}

run();
