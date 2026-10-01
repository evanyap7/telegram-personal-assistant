import assert from "node:assert/strict";
import {
  calculateEstimated1RM,
  calculateSessionVolume,
  generateProgressiveOverloadTarget,
  buildWorkoutPlanForLocation,
} from "../lib/workout/progressive-overload";
import { parseWorkoutText } from "../lib/workout/workout-handler";
import type { WorkoutSet } from "../lib/workout/workout-types";

function runWorkoutTests() {
  console.log("\n=======================================================");
  console.log("  🏋️ Workout & Progressive Overload Engine Tests");
  console.log("=======================================================\n");

  // 1. Estimated 1RM calculation (Epley formula: W * (1 + R / 30))
  console.log("Test 1: Estimated 1RM calculations...");
  const e1rm100x6 = calculateEstimated1RM(100, 6);
  // 100 * (1 + 6/30) = 100 * 1.2 = 120
  assert.equal(e1rm100x6, 120, "100kg x 6 should equal 120kg 1RM");

  const e1rm90x8 = calculateEstimated1RM(90, 8);
  // 90 * (1 + 8/30) = 90 * 1.2667 = 114
  assert.equal(e1rm90x8, 114, "90kg x 8 should equal 114kg 1RM");
  console.log("  ✅ E1RM formula validated.\n");

  // 2. Session Volume (Tonnage)
  console.log("Test 2: Session volume / tonnage calculations...");
  const sampleSets: WorkoutSet[] = [
    { exercise: "Incline Smith", setNumber: 1, weightKg: 100, reps: 5 }, // 500
    { exercise: "Incline Smith", setNumber: 2, weightKg: 100, reps: 4 }, // 400
    { exercise: "Incline Smith", setNumber: 3, weightKg: 80, reps: 7 },  // 560
    { exercise: "Incline Smith", setNumber: 4, weightKg: 60, reps: 3, isDropSet: true }, // 180
  ];
  const totalVol = calculateSessionVolume(sampleSets);
  assert.equal(totalVol, 1640, "Total volume should be 1640kg");
  console.log("  ✅ Session tonnage calculated accurately.\n");

  // 3. Double Progression Rules
  console.log("Test 3: Science-backed Double Progression recommendations...");

  // Scenario A: Hit top of rep bracket (8 reps on Pec Dec @ 100kg) -> Load increase (+2.5kg)
  const targetLoadIncrease = generateProgressiveOverloadTarget({
    exerciseName: "Pec Dec Fly",
    location: "school",
    previousSets: [
      { exercise: "Pec Dec Fly", setNumber: 1, weightKg: 100, reps: 8 },
      { exercise: "Pec Dec Fly", setNumber: 2, weightKg: 100, reps: 6 },
    ],
  });
  assert.equal(targetLoadIncrease.targetWeightKg, 102.5, "Should recommend +2.5kg increase");
  assert.equal(targetLoadIncrease.targetRepsMin, 6, "Should reset rep target to bracket min (6)");
  console.log(`  ✅ Load bump: ${targetLoadIncrease.progressiveOverloadReason}`);

  // Scenario B: Mid rep bracket (5.5 reps on Incline Smith @ 100kg) -> Rep accumulation
  const targetRepAccumulation = generateProgressiveOverloadTarget({
    exerciseName: "Incline Smith Press",
    location: "school",
    previousSets: [
      { exercise: "Incline Smith Press", setNumber: 1, weightKg: 100, reps: 5.5 },
      { exercise: "Incline Smith Press", setNumber: 2, weightKg: 100, reps: 4 },
    ],
  });
  assert.equal(targetRepAccumulation.targetWeightKg, 100, "Should maintain 100kg load");
  assert.equal(targetRepAccumulation.targetRepsMin, 6, "Should aim for +1 rep (6 reps)");
  console.log(`  ✅ Rep accumulation: ${targetRepAccumulation.progressiveOverloadReason}`);

  // Scenario C: Bodyweight lift (Pull-ups: 15 reps) -> Rep progression
  const targetPullups = generateProgressiveOverloadTarget({
    exerciseName: "Pull-ups",
    location: "csc",
    previousSets: [
      { exercise: "Pull-ups", setNumber: 1, weightKg: 0, reps: 15 },
      { exercise: "Pull-ups", setNumber: 2, weightKg: 0, reps: 9 },
    ],
  });
  assert.equal(targetPullups.targetWeightKg, 0, "Weight should stay bodyweight (0kg)");
  assert.equal(targetPullups.targetRepsMin, 16, "Target should increase to 16 reps");
  console.log(`  ✅ Bodyweight progression: ${targetPullups.progressiveOverloadReason}\n`);

  // 4. Workout Plan Generation for School & CSC
  console.log("Test 4: Workout plan generation for School and CSC...");
  const schoolPlan = buildWorkoutPlanForLocation({ location: "school" });
  assert.equal(schoolPlan.location, "school");
  assert.ok(schoolPlan.targets.some((t) => t.exercise.includes("Incline Smith")));
  assert.ok(schoolPlan.targets.some((t) => t.exercise.includes("T-Bar")));
  assert.ok(schoolPlan.targets.some((t) => t.exercise.includes("Lat Pulldown")));

  const cscPlan = buildWorkoutPlanForLocation({ location: "csc" });
  assert.equal(cscPlan.location, "csc");
  assert.ok(cscPlan.targets.some((t) => t.exercise.includes("Bench Press")));
  assert.ok(cscPlan.targets.some((t) => t.exercise.includes("Pull-ups")));
  assert.ok(cscPlan.targets.some((t) => t.exercise.includes("Skullcrushers")));
  console.log("  ✅ Both School and CSC routine targets generated.\n");

  console.log("🎉 All Workout Engine unit tests passed!\n");
}

runWorkoutTests();
