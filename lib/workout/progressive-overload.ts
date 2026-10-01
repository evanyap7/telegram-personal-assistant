import type {
  ExerciseTarget,
  GymLocation,
  WorkoutPlan,
  WorkoutSet,
} from "./workout-types";
import { STANDARD_EXERCISES } from "./workout-types";

/**
 * Calculates estimated 1 Rep Max using the Epley formula:
 * 1RM = Weight * (1 + Reps / 30)
 * Validated by exercise science literature (LeSuer et al., 1997).
 */
export function calculateEstimated1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  const e1rm = weightKg * (1 + reps / 30);
  return Math.round(e1rm * 10) / 10;
}

/**
 * Calculates total session training tonnage (Volume in kg):
 * Volume = Sum(Weight * Reps)
 */
export function calculateSessionVolume(sets: WorkoutSet[]): number {
  return sets.reduce((acc, set) => {
    const effectiveWeight = set.weightKg > 0 ? set.weightKg : 0;
    return acc + effectiveWeight * set.reps;
  }, 0);
}

/**
 * Science-Backed Progressive Overload Recommendation Engine
 *
 * Implements the Double Progression Model (Helms, Schoenfeld et al.):
 * 1. Keep load constant until top of target rep bracket is achieved on working sets.
 * 2. When top bracket is achieved, increment load by smallest micro-increment (2.5% - 5%).
 * 3. Drop rep target to bottom of bracket and repeat progression.
 * 4. Incorporate back-off sets (80% load) for hypertrophic volume when fatigue is high.
 */
export function generateProgressiveOverloadTarget(params: {
  exerciseName: string;
  location: GymLocation;
  previousSets?: WorkoutSet[];
}): ExerciseTarget {
  const { exerciseName, location, previousSets = [] } = params;
  const normalizedKey = exerciseName.toLowerCase().trim();

  // Find standard configuration or default
  const standardConfig =
    STANDARD_EXERCISES[location]?.[normalizedKey] ||
    Object.values(STANDARD_EXERCISES[location] || {}).find(
      (c) => c.canonicalName.toLowerCase() === normalizedKey
    ) || {
      canonicalName: exerciseName,
      category: "compound" as const,
      repTargetMin: 6,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    };

  // Case 1: First time performing this exercise (no past sets)
  if (previousSets.length === 0) {
    return {
      exercise: standardConfig.canonicalName,
      targetWeightKg: 0,
      targetRepsMin: standardConfig.repTargetMin,
      targetRepsMax: standardConfig.repTargetMax,
      targetSets: 3,
      progressiveOverloadReason: "Baseline session: Focus on RPE 7-8 and establishing technical proficiency.",
    };
  }

  // Filter out drop sets to assess primary working sets
  const primaryWorkingSets = previousSets.filter((s) => !s.isDropSet);
  const topSet = primaryWorkingSets.length > 0 ? primaryWorkingSets[0] : previousSets[0];
  const lastWeight = topSet.weightKg;
  const lastReps = topSet.reps;

  // Bodyweight movements (e.g. Pull-ups)
  if (standardConfig.category === "bodyweight" || lastWeight === 0) {
    const targetReps = Math.ceil(lastReps + 1);
    return {
      exercise: standardConfig.canonicalName,
      targetWeightKg: 0,
      targetRepsMin: targetReps,
      targetRepsMax: targetReps + 2,
      targetSets: previousSets.length || 2,
      previousBestWeightKg: 0,
      previousBestReps: lastReps,
      progressiveOverloadReason: `Rep Progression: Last hit ${lastReps} reps. Aim for ${targetReps} reps (+1) before adding external load.`,
    };
  }

  // Double Progression Rule 1: Hit or exceeded top of rep bracket (e.g. >= 8 reps)
  if (lastReps >= standardConfig.repTargetMax) {
    const newWeight = lastWeight + standardConfig.weightIncrementKg;
    return {
      exercise: standardConfig.canonicalName,
      targetWeightKg: newWeight,
      targetRepsMin: standardConfig.repTargetMin,
      targetRepsMax: standardConfig.repTargetMin + 2,
      targetSets: previousSets.length,
      previousBestWeightKg: lastWeight,
      previousBestReps: lastReps,
      progressiveOverloadReason: `Load Bump: Reached top of bracket (${lastReps} reps @ ${lastWeight}kg). Micro-overload to ${newWeight}kg for ${standardConfig.repTargetMin}-${standardConfig.repTargetMin + 2} reps.`,
      backOffSet: {
        weightKg: Math.round((lastWeight * 0.8) / 2.5) * 2.5,
        reps: `${standardConfig.repTargetMin + 2}-${standardConfig.repTargetMax}`,
        notes: "Optional back-off volume set at 80% load",
      },
    };
  }

  // Double Progression Rule 2: In middle of rep bracket (e.g. 5.5 - 7 reps)
  if (lastReps >= standardConfig.repTargetMin) {
    const nextRepTarget = Math.min(
      standardConfig.repTargetMax,
      Math.floor(lastReps + 1)
    );
    return {
      exercise: standardConfig.canonicalName,
      targetWeightKg: lastWeight,
      targetRepsMin: nextRepTarget,
      targetRepsMax: standardConfig.repTargetMax,
      targetSets: previousSets.length,
      previousBestWeightKg: lastWeight,
      previousBestReps: lastReps,
      progressiveOverloadReason: `Rep Accumulation: Last hit ${lastReps} reps @ ${lastWeight}kg. Hold weight and push for +1 rep (Target: ${nextRepTarget} reps) with controlled tempo.`,
      backOffSet:
        previousSets.length > 2
          ? {
              weightKg: Math.round((lastWeight * 0.8) / 2.5) * 2.5,
              reps: `${standardConfig.repTargetMin}-${standardConfig.repTargetMax}`,
              notes: "Back-off set for hypertrophy stimulus",
            }
          : undefined,
    };
  }

  // Double Progression Rule 3: Below target rep bracket (e.g. < 5 reps)
  return {
    exercise: standardConfig.canonicalName,
    targetWeightKg: lastWeight,
    targetRepsMin: standardConfig.repTargetMin,
    targetRepsMax: standardConfig.repTargetMin + 1,
    targetSets: previousSets.length,
    previousBestWeightKg: lastWeight,
    previousBestReps: lastReps,
    progressiveOverloadReason: `Load Consolidation: Last hit ${lastReps} reps @ ${lastWeight}kg. Keep load and lock in 2-3 sec eccentrics to secure ${standardConfig.repTargetMin} solid reps.`,
  };
}

/**
 * Builds a complete workout setup plan with progressive overload targets
 * tailored for School or CSC gym locations.
 */
export function buildWorkoutPlanForLocation(params: {
  location: GymLocation;
  week?: number;
  pastSessionSets?: Map<string, WorkoutSet[]>;
}): WorkoutPlan {
  const { location, week, pastSessionSets = new Map() } = params;

  const exercises = STANDARD_EXERCISES[location];
  const targets: ExerciseTarget[] = [];

  for (const [key, config] of Object.entries(exercises)) {
    const pastSets = pastSessionSets.get(key) || pastSessionSets.get(config.canonicalName.toLowerCase()) || [];
    const target = generateProgressiveOverloadTarget({
      exerciseName: config.canonicalName,
      location,
      previousSets: pastSets,
    });
    targets.push(target);
  }

  return {
    location,
    routine: "Upper Body",
    week,
    targets,
    sciencePrinciples: [
      "Double Progression: Match reps before increasing load",
      "Rest intervals: 2-3 min for compounds, 1.5 min for isolations",
      "Proximity to failure: Stop 1-2 reps shy of technical failure (RIR 1-2)",
    ],
  };
}
