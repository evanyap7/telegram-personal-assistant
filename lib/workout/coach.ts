import { calculateEstimated1RM } from "./progressive-overload";

export type ExerciseKind = "main" | "compound" | "isolation";

/** Squat/bench/deadlift are the main lifts; arms, delts, calves and machines are isolation work. */
export function exerciseKind(name: string): ExerciseKind {
  if (/^(squat|bench press|deadlift)\b/i.test(name)) return "main";
  if (/curl|tricep|push-?down|skullcrusher|raise|fly|extension|calf|hyper/i.test(name)) return "isolation";
  return "compound";
}

const REST: Record<ExerciseKind, string> = {
  main: "3-5 min",
  compound: "about 2 min",
  isolation: "60-90 s",
};

/** Default auto-started rest per exercise kind, inside the ranges the coach line quotes above. */
export const DEFAULT_REST_SECONDS: Record<ExerciseKind, number> = {
  main: 180,
  compound: 120,
  isolation: 75,
};

export interface RepTarget {
  min: number;
  max: number;
  amrap: boolean;
}

/** Reads a sheet rep cell: "x9", "x6-8", "AMRAP", "11". Null when there's no usable target. */
export function parseRepTarget(reps: string): RepTarget | null {
  const t = reps.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("amrap")) return { min: 0, max: 0, amrap: true };
  const m = t.replace(/^x\s*/, "").match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const min = parseFloat(m[1]);
  return { min, max: m[2] ? parseFloat(m[2]) : min, amrap: false };
}

/**
 * One line of coaching after a logged set: how it compared with the target, and how long to
 * rest. Direct about effort and standards, and never asks for more load or volume than the sheet
 * prescribes. Plain text, so it is safe inside a Telegram message.
 */
export function coachLine(params: {
  exercise: string;
  targetReps: string;
  weightKg: number;
  reps: number;
  /** The set just logged was the exercise's last: no rest note, the next exercise follows. */
  isLastSet: boolean;
}): string {
  const { exercise, targetReps, weightKg, reps, isLastSet } = params;
  const kind = exerciseKind(exercise);
  const target = parseRepTarget(targetReps);
  const rest = isLastSet ? "" : ` Rest ${REST[kind]}.`;

  if (target?.amrap) {
    if (kind === "main" && weightKg > 0) {
      const e1rm = calculateEstimated1RM(weightKg, reps);
      return `AMRAP: ${reps} reps at ${weightKg}kg is an estimated 1RM of ${e1rm}kg. That number sets your next weights, so every rep must have been clean.${rest}`;
    }
    return `AMRAP logged. Leave nothing but your form behind.${rest}`;
  }

  if (!target) return rest.trim();

  if (reps > target.max + 1) {
    const over = reps - target.max;
    return kind === "main"
      ? `${over} over target. That was too light: your max is higher than the sheet thinks, so update the yellow box.${rest}`
      : `${over} over the top of the range. Add the smallest plate next time.${rest}`;
  }
  if (reps >= target.min) {
    if (kind !== "main" && reps >= target.max && target.max > target.min) {
      return `Top of the range. Hit it on every set and the weight goes up.${rest}`;
    }
    return `On target.${rest}`;
  }
  const short = target.min - reps;
  return kind === "main"
    ? `${short} short. Take the full rest and make the next set cleaner. No grinding past your form.${rest}`
    : `${short} short of the range. Miss it again next session and the weight drops about 5%.${rest}`;
}
