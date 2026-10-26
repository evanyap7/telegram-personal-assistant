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
import { columnToA1, formatSheetReps, getBlockInfo, programDayFromWeekDay } from "../lib/workout/ph3-program";
import { coachLine, exerciseKind, parseRepTarget } from "../lib/workout/coach";
import { formatRestDuration, parseRestCommand, parseRestDuration } from "../lib/workout/rest-command";

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

  // Week/day and restart phrasing
  assert.equal(programDayFromWeekDay(1, 1), 1);
  assert.equal(programDayFromWeekDay(3, 2), 16);
  assert.equal(programDayFromWeekDay(13, 6), 90);
  assert.equal(programDayFromWeekDay(13, 7), null);
  assert.equal(programDayFromWeekDay(14, 1), null);
  assert.equal(programDayFromWeekDay(2, 8), null);
  // The message that wrongly started Day 3: reposition only, because it says "tomorrow".
  assert.deepEqual(parseWorkoutDayCommand("im going to work out tomorrow lets start over from week 1 day 1"), {
    kind: "set",
    day: 1,
    startImmediately: false,
  });
  assert.deepEqual(parseWorkoutDayCommand("lets start over from week 1 day 1"), { kind: "set", day: 1, startImmediately: true });
  assert.deepEqual(parseWorkoutDayCommand("restart the program"), { kind: "set", day: 1, startImmediately: true });
  assert.deepEqual(parseWorkoutDayCommand("start from the beginning tomorrow"), { kind: "set", day: 1, startImmediately: false });
  assert.deepEqual(parseWorkoutDayCommand("start week 3 day 2"), { kind: "set", day: 16, startImmediately: true });
  assert.deepEqual(parseWorkoutDayCommand("go to week 2, day 4"), { kind: "set", day: 11, startImmediately: true });
  assert.deepEqual(parseWorkoutDayCommand("week 2 day 4"), { kind: "set", day: 11, startImmediately: false });
  for (const t of ["start over", "redo that set", "reset the set", "week 14 day 1", "I did week 3 day 2 last time", "100 x 5"]) {
    assert.equal(parseWorkoutDayCommand(t), null, `not a day command: ${t}`);
  }
  console.log("  ✅ week/day and restart commands");

  // Coaching lines
  assert.deepEqual(parseRepTarget("x9"), { min: 9, max: 9, amrap: false });
  assert.deepEqual(parseRepTarget("x6-8"), { min: 6, max: 8, amrap: false });
  assert.deepEqual(parseRepTarget("AMRAP"), { min: 0, max: 0, amrap: true });
  assert.equal(parseRepTarget(""), null);
  assert.equal(parseRepTarget("Set 1"), null);
  assert.equal(exerciseKind("Squat (AMRAP Set 4)"), "main");
  assert.equal(exerciseKind("Bench Press (1s pause)"), "main");
  assert.equal(exerciseKind("Preacher Curl"), "isolation");
  assert.equal(exerciseKind("Leg Curl (3 RIR)"), "isolation");
  assert.equal(exerciseKind("Lat Pull-down"), "compound");
  const line = (exercise: string, targetReps: string, weightKg: number, reps: number, isLastSet = false) =>
    coachLine({ exercise, targetReps, weightKg, reps, isLastSet });
  assert.match(line("Squat", "x7", 107.5, 7), /^On target\. Rest 3-5 min\.$/);
  assert.match(line("Squat", "x7", 107.5, 9), /2 over target.*too light.*yellow box/);
  assert.match(line("Squat", "x7", 107.5, 8), /^On target/, "one over is still on target");
  assert.match(line("Squat", "x7", 107.5, 3), /4 short.*No grinding/);
  assert.match(line("Squat", "AMRAP", 132.5, 11), /estimated 1RM of 181\.1kg/);
  assert.match(line("Cable Curl (2RIR)", "x10-15", 20, 15), /Top of the range/);
  assert.match(line("Cable Curl (2RIR)", "x10-15", 20, 7), /3 short of the range.*drops about 5%/);
  assert.match(line("Lat Pull-down", "x8", 82, 8, false), /Rest about 2 min/);
  assert.equal(line("Lat Pull-down", "x8", 82, 8, true), "On target.", "no rest note after the last set");
  assert.equal(line("Squat", "", 100, 5, true), "", "nothing to say without a target");
  console.log("  ✅ coaching lines");

  assert.equal(parseRestDuration("4m"), 240);
  assert.equal(parseRestDuration("90s"), 90);
  assert.equal(parseRestDuration("1.5m"), 90);
  assert.equal(parseRestDuration("3"), 180, "bare small numbers are minutes");
  assert.equal(parseRestDuration("90"), 90, "bare large numbers are seconds");
  assert.equal(parseRestDuration("5s"), null, "below the minimum");
  assert.equal(parseRestDuration("20m"), null, "above the maximum");
  assert.equal(parseRestDuration("soon"), null);
  assert.equal(parseRestCommand("/workout"), null);
  assert.deepEqual(parseRestCommand("/rest"), { kind: "show" });
  assert.deepEqual(parseRestCommand("/rest OFF"), { kind: "off" });
  assert.deepEqual(parseRestCommand("/rest reset"), { kind: "reset" });
  assert.deepEqual(parseRestCommand("/rest main 4m"), { kind: "set", exercise: "main", seconds: 240 });
  assert.deepEqual(parseRestCommand("/rest accessories 60 s"), { kind: "set", exercise: "isolation", seconds: 60 });
  assert.equal(parseRestCommand("/rest main")?.kind, "usage_error");
  assert.equal(parseRestCommand("/rest biceps 2m")?.kind, "usage_error");
  assert.equal(parseRestCommand("/rest main 1s")?.kind, "usage_error");
  assert.equal(formatRestDuration(75), "75s");
  assert.equal(formatRestDuration(180), "3 min");
  assert.equal(formatRestDuration(150), "2.5 min");
  console.log("  ✅ rest timer settings");

  console.log("\n  All workout session tests passed.\n");
}

run();
