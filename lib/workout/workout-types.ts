export type GymLocation = "school" | "csc";

export type RoutineType = "upper" | "lower" | "push" | "pull" | "legs" | "fullbody";

export interface WorkoutSet {
  exercise: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  isDropSet?: boolean;
  isTempo?: boolean;
  notes?: string;
  rpe?: number;
  estimated1RM?: number;
  volumeKg?: number;
}

export interface WorkoutSession {
  sessionId: string;
  date: string; // YYYY-MM-DD
  week?: number;
  location: GymLocation | "ph3";
  routine: RoutineType | string;
  sets: WorkoutSet[];
  totalVolumeKg: number;
  createdAt: string;
}

export interface ExerciseTarget {
  exercise: string;
  targetWeightKg: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetSets: number;
  previousBestWeightKg?: number;
  previousBestReps?: number;
  progressiveOverloadReason: string;
  backOffSet?: {
    weightKg: number;
    reps: string;
    notes?: string;
  };
}

export interface WorkoutPlan {
  location: GymLocation;
  routine: string;
  week?: number;
  targets: ExerciseTarget[];
  sciencePrinciples: string[];
}

export const STANDARD_EXERCISES: Record<GymLocation, Record<string, {
  canonicalName: string;
  category: "compound" | "isolation" | "bodyweight";
  repTargetMin: number;
  repTargetMax: number;
  weightIncrementKg: number;
}>> = {
  school: {
    "incline smith": {
      canonicalName: "Incline Smith Press",
      category: "compound",
      repTargetMin: 5,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "t bar": {
      canonicalName: "T-Bar Row",
      category: "compound",
      repTargetMin: 6,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "pec dec": {
      canonicalName: "Pec Dec Fly",
      category: "isolation",
      repTargetMin: 6,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "lat pd": {
      canonicalName: "Lat Pulldown",
      category: "compound",
      repTargetMin: 6,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "lateral raises db seated": {
      canonicalName: "Seated DB Lateral Raises",
      category: "isolation",
      repTargetMin: 8,
      repTargetMax: 12,
      weightIncrementKg: 2.0, // Pair of DBs
    },
    "bicep sa": {
      canonicalName: "Single-Arm Bicep Curl",
      category: "isolation",
      repTargetMin: 7,
      repTargetMax: 10,
      weightIncrementKg: 2.5,
    },
    "tricep ext": {
      canonicalName: "Tricep Extension",
      category: "isolation",
      repTargetMin: 8,
      repTargetMax: 12,
      weightIncrementKg: 2.5,
    },
  },
  csc: {
    "bench press": {
      canonicalName: "Barbell Bench Press",
      category: "compound",
      repTargetMin: 5,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "t bar": {
      canonicalName: "T-Bar Row",
      category: "compound",
      repTargetMin: 6,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "pec dec": {
      canonicalName: "Pec Dec Fly",
      category: "isolation",
      repTargetMin: 6,
      repTargetMax: 8,
      weightIncrementKg: 2.5,
    },
    "pull ups": {
      canonicalName: "Pull-ups",
      category: "bodyweight",
      repTargetMin: 8,
      repTargetMax: 15,
      weightIncrementKg: 0,
    },
    "machine lateral raises": {
      canonicalName: "Machine Lateral Raises",
      category: "isolation",
      repTargetMin: 10,
      repTargetMax: 15,
      weightIncrementKg: 2.5,
    },
    "skullcrushers": {
      canonicalName: "Skullcrushers",
      category: "isolation",
      repTargetMin: 7,
      repTargetMax: 11,
      weightIncrementKg: 2.5,
    },
    "bicep": {
      canonicalName: "Bicep Curls",
      category: "isolation",
      repTargetMin: 8,
      repTargetMax: 12,
      weightIncrementKg: 2.5,
    },
  },
};
