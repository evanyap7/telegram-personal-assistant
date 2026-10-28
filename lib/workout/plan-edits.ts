import type { PH3DayPlan, PH3Exercise, PH3ExerciseSet } from "./ph3-program";

/**
 * Edits layered over the program sheet. The sheet stays the source of truth for the original
 * plan; edits rename, drop, add or retarget exercises on top of it. Every edit is idempotent,
 * so applying persistent edits and session edits to the same plan never double-counts.
 */
export type PlanEdit = (
  | { kind: "swap"; from: string; to: string }
  | { kind: "remove"; exercise: string }
  | { kind: "add"; exercise: string; sets: number; reps: string; weight?: string; position?: number }
  | { kind: "targets"; exercise: string; sets?: number; reps?: string; weight?: string }
) & {
  /** Day of the week (1-7) the edit is limited to; absent means every day. */
  weekday?: number;
  /** ISO timestamp, for listing. */
  at?: string;
};

/** Where an edit applies: this session only, every future occurrence, or one weekday slot. */
export type EditScope = "today" | "from_now_on" | "this_weekday";

export function weekdayOf(day: number): number {
  return ((day - 1) % 7) + 1;
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findIdx(exercises: PH3Exercise[], name: string): number {
  return exercises.findIndex((e) => sameName(e.exercise, name));
}

/** A set with no sheet cells; its results go to the Workouts tab instead. */
export function syntheticSet(setNumber: number, weight: string, reps: string): PH3ExerciseSet {
  return { setNumber, weight, reps, weightCell: "", repsCell: "" };
}

export function hasSheetCells(set: PH3ExerciseSet): boolean {
  return set.weightCell !== "" && set.repsCell !== "";
}

function retarget(ex: PH3Exercise, t: { sets?: number; reps?: string; weight?: string }): PH3Exercise {
  let sets = ex.sets.map((s) => ({
    ...s,
    ...(t.reps !== undefined ? { reps: t.reps } : {}),
    ...(t.weight !== undefined ? { weight: t.weight } : {}),
  }));
  if (t.sets !== undefined) {
    if (t.sets < sets.length) {
      sets = sets.slice(0, t.sets);
    } else {
      const template = sets[sets.length - 1];
      for (let n = sets.length + 1; n <= t.sets; n++) {
        sets.push(syntheticSet(n, template?.weight ?? t.weight ?? "", template?.reps ?? t.reps ?? ""));
      }
    }
  }
  return { ...ex, sets };
}

export function applyEdits(plan: PH3DayPlan, edits: PlanEdit[]): PH3DayPlan {
  if (edits.length === 0) return plan;
  const weekday = weekdayOf(plan.day);
  let exercises = plan.exercises.map((e) => ({ ...e }));

  for (const edit of edits) {
    if (edit.weekday !== undefined && edit.weekday !== weekday) continue;
    switch (edit.kind) {
      case "swap": {
        const i = findIdx(exercises, edit.from);
        // A swap onto a name already in the plan would collide with its logged sets.
        if (i !== -1 && findIdx(exercises, edit.to) === -1) {
          exercises[i] = { ...exercises[i], exercise: edit.to };
        }
        break;
      }
      case "remove": {
        const i = findIdx(exercises, edit.exercise);
        if (i !== -1) exercises = exercises.filter((_, j) => j !== i);
        break;
      }
      case "add": {
        if (findIdx(exercises, edit.exercise) !== -1) break;
        const sets = Array.from({ length: Math.max(1, edit.sets) }, (_, n) =>
          syntheticSet(n + 1, edit.weight ?? "", edit.reps)
        );
        const at =
          edit.position === undefined
            ? exercises.length
            : Math.min(Math.max(edit.position - 1, 0), exercises.length);
        exercises.splice(at, 0, { exercise: edit.exercise, sets });
        break;
      }
      case "targets": {
        const i = findIdx(exercises, edit.exercise);
        if (i !== -1) exercises[i] = retarget(exercises[i], edit);
        break;
      }
    }
  }
  return { ...plan, exercises };
}

type SwapEdit = Extract<PlanEdit, { kind: "swap" }>;

/**
 * Adds a swap to a persistent list. Swapping an exercise that is itself a previous swap's
 * replacement updates that entry, and swapping back to the original drops it.
 */
export function upsertSwap(edits: PlanEdit[], current: string, to: string, weekday?: number): PlanEdit[] {
  const at = new Date().toISOString();
  const existing = edits.findIndex(
    (e) => e.kind === "swap" && sameName(e.to, current) && e.weekday === weekday
  );
  if (existing === -1) return [...edits, { kind: "swap", from: current, to, weekday, at }];
  const prior = edits[existing] as SwapEdit;
  if (sameName(prior.from, to)) return edits.filter((_, i) => i !== existing);
  return edits.map((e, i) => (i === existing ? { ...prior, to, at } : e));
}

/** Drops the persistent swap whose replacement is `current`; returns the original name if one was found. */
export function removeSwap(
  edits: PlanEdit[],
  current: string
): { edits: PlanEdit[]; original: string | null } {
  const i = edits.findIndex((e) => e.kind === "swap" && sameName(e.to, current));
  if (i === -1) return { edits, original: null };
  return { edits: edits.filter((_, j) => j !== i), original: (edits[i] as SwapEdit).from };
}

export function describeEdit(e: PlanEdit): string {
  const where = e.weekday === undefined ? "every day" : `weekday ${e.weekday} only`;
  switch (e.kind) {
    case "swap":
      return `${e.from} → ${e.to} (${where})`;
    case "remove":
      return `removed ${e.exercise} (${where})`;
    case "add":
      return `added ${e.exercise}, ${e.sets} sets of ${e.reps} (${where})`;
    case "targets": {
      const parts = [
        e.sets !== undefined ? `${e.sets} sets` : "",
        e.reps !== undefined ? `${e.reps} reps` : "",
        e.weight !== undefined ? `${e.weight}kg` : "",
      ].filter(Boolean);
      return `${e.exercise}: ${parts.join(", ")} (${where})`;
    }
  }
}
