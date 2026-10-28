import { getSheetsClient } from "../google";
import { deleteMemory, getMemoryByKey, saveMemory } from "../memory";
import { applyEdits } from "./plan-edits";
import { loadPlanEdits } from "./plan-edits-store";

export interface PH3ExerciseSet {
  setNumber: number;
  weight: string;
  reps: string;
  /** A1 cell (no tab name) where this set's actual weight is logged, e.g. "P15". */
  weightCell: string;
  /** A1 cell (no tab name) holding the prescribed rep range, e.g. "Q15". Overwritten with the actual reps. */
  repsCell: string;
}

export interface PH3Exercise {
  exercise: string;
  sets: PH3ExerciseSet[];
  /** A1 cell (no tab name) holding the exercise name; absent for exercises added by a plan edit. */
  nameCell?: string;
}

export interface PH3DayPlan {
  day: number;
  week: number;
  blockTab: string;
  dayTitle: string;
  exercises: PH3Exercise[];
  isRestDay: boolean;
}

export interface PH3UserProgress {
  currentWeek: number; // 1 to 13
  currentDay: number; // 1 to 90
  activeExercise?: string;
  completedTodayExercises: string[];
  lastSessionDate?: string;
}

// In-memory cache for sheet data to avoid excessive API calls
const planCache = new Map<number, { plan: PH3DayPlan; cachedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PLAN_RANGE_START_ROW = 7;

/** Converts a 0-based column index to A1 letters (0 -> A, 26 -> AA). */
export function columnToA1(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function getSpreadsheetId(): string {
  const spreadsheetId =
    process.env.GOOGLE_WORKOUT_SHEET_ID || process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error(
      "GOOGLE_WORKOUT_SHEET_ID (or GOOGLE_SHEET_ID) is missing."
    );
  }
  return spreadsheetId;
}

export function getBlockInfo(day: number): {
  tab: string;
  week: number;
  colOffset: number;
} {
  if (day >= 1 && day <= 28) {
    const week = Math.floor((day - 1) / 7) + 1;
    const weekIndexInBlock = week - 1;
    return {
      tab: "Accumulation Block",
      week,
      colOffset: weekIndexInBlock * 13,
    };
  }
  if (day >= 29 && day <= 56) {
    const week = Math.floor((day - 29) / 7) + 5;
    const weekIndexInBlock = week - 5;
    return {
      tab: "Intermediate Block",
      week,
      colOffset: weekIndexInBlock * 13,
    };
  }
  if (day >= 57 && day <= 84) {
    const week = Math.floor((day - 57) / 7) + 9;
    const weekIndexInBlock = week - 9;
    return {
      tab: "Intensity Block",
      week,
      colOffset: weekIndexInBlock * 13,
    };
  }
  if (day >= 85 && day <= 90) {
    return {
      tab: "Taper (Final Week)",
      week: 13,
      colOffset: 0,
    };
  }
  throw new Error(`PH3 day must be between 1 and 90. Received: ${day}`);
}

/**
 * Program day (1-90) for "week 3, day 2". Weeks 1-12 have 7 days; the final week has days 85-90.
 * Returns null when the pair is not a real program day.
 */
export function programDayFromWeekDay(week: number, dayOfWeek: number): number | null {
  if (!Number.isInteger(week) || !Number.isInteger(dayOfWeek)) return null;
  if (week < 1 || week > 13 || dayOfWeek < 1 || dayOfWeek > 7) return null;
  const day = (week - 1) * 7 + dayOfWeek;
  return day >= 1 && day <= 90 ? day : null;
}

/**
 * Parses and retrieves the workout plan for a specific day from the Google Sheet.
 */
export async function getDayPlan(day: number, forceRefresh = false): Promise<PH3DayPlan> {
  const cached = planCache.get(day);
  if (!forceRefresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return applyEdits(cached.plan, await loadPlanEdits());
  }

  const info = getBlockInfo(day);
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${info.tab}'!A${PLAN_RANGE_START_ROW}:AZ85`,
  });

  const rows = res.data.values || [];
  const targetDayRegex = new RegExp(`^Day\\s+${day}\\b`, "i");
  let dayTitle = `Day ${day}`;
  let inDay = false;
  const exercises: PH3Exercise[] = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cellVal = String(row[info.colOffset] || "").trim();

    if (/^Day\s+\d+/i.test(cellVal)) {
      if (inDay) break; // Reached next day
      if (targetDayRegex.test(cellVal)) {
        inDay = true;
        dayTitle = cellVal;
        continue;
      }
    }

    if (inDay) {
      if (!cellVal || cellVal === "Exercise" || cellVal.startsWith("Week")) continue;
      const sets: PH3ExerciseSet[] = [];
      const sheetRow = PLAN_RANGE_START_ROW + r;
      for (let s = 0; s < 5; s++) {
        const wIdx = info.colOffset + 2 + s * 2;
        const rIdx = info.colOffset + 3 + s * 2;
        const weight = String(row[wIdx] || "").trim();
        const reps = String(row[rIdx] || "").trim();
        if (weight || reps) {
          sets.push({
            setNumber: s + 1,
            weight,
            reps,
            weightCell: `${columnToA1(wIdx)}${sheetRow}`,
            repsCell: `${columnToA1(rIdx)}${sheetRow}`,
          });
        }
      }
      if (sets.length > 0) {
        exercises.push({ exercise: cellVal, sets, nameCell: `${columnToA1(info.colOffset)}${sheetRow}` });
      }
    }
  }

  const plan: PH3DayPlan = {
    day,
    week: info.week,
    blockTab: info.tab,
    dayTitle,
    exercises,
    isRestDay: exercises.length === 0 || /rest/i.test(dayTitle),
  };

  // The cache holds the plan as the sheet has it; edits are layered on per call.
  planCache.set(day, { plan, cachedAt: Date.now() });
  return applyEdits(plan, await loadPlanEdits());
}

/** Writes an exercise name into its sheet cell, so the sheet shows what was actually done. */
export async function writeExerciseName(plan: PH3DayPlan, nameCell: string, name: string): Promise<void> {
  await getSheetsClient().spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: cellRange(plan, nameCell),
    valueInputOption: "RAW",
    requestBody: { values: [[name]] },
  });
  planCache.delete(plan.day);
}

const MEMORY_PROGRESS_KEY = "ph3_workout_progress";

/**
 * Retrieves the user's current progress in PH3 (current day, week, active exercise, completed sets).
 * Always read from the Memory sheet: serverless instances don't share memory, so a cached
 * copy could be stale after another instance advances the day.
 */
export async function getUserPH3Progress(): Promise<PH3UserProgress> {
  try {
    const memoryRecord = await getMemoryByKey(MEMORY_PROGRESS_KEY, "preference");
    if (memoryRecord?.value) {
      const parsed = JSON.parse(memoryRecord.value) as PH3UserProgress;
      if (parsed.currentDay >= 1 && parsed.currentDay <= 90) {
        return parsed;
      }
    }
  } catch {
    // If not found or invalid JSON, initialize default
  }

  return {
    currentWeek: 1,
    currentDay: 1,
    completedTodayExercises: [],
    lastSessionDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  };
}

/**
 * Saves updated PH3 progress to persistent Google Sheets memory.
 */
export async function saveUserPH3Progress(progress: PH3UserProgress): Promise<void> {
  await saveMemory({
    category: "preference",
    key: MEMORY_PROGRESS_KEY,
    value: JSON.stringify(progress),
    tags: ["ph3", "workout", "fitness"],
  });
}

/**
 * Sets user to a specific day, automatically updating week and resetting daily exercise list.
 */
export async function setUserPH3Day(day: number): Promise<PH3UserProgress> {
  const validDay = Math.max(1, Math.min(90, day));
  const info = getBlockInfo(validDay);
  const current = await getUserPH3Progress();

  const updated: PH3UserProgress = {
    ...current,
    currentDay: validDay,
    currentWeek: info.week,
    activeExercise: undefined,
    completedTodayExercises: [],
  };

  await saveUserPH3Progress(updated);
  return updated;
}

/**
 * Advances user to the next day in the PH3 cycle.
 */
export async function advanceUserPH3Day(): Promise<PH3UserProgress> {
  const current = await getUserPH3Progress();
  const nextDay = current.currentDay >= 90 ? 1 : current.currentDay + 1;
  return setUserPH3Day(nextDay);
}

/**
 * Sets the active exercise the user is currently performing.
 */
export async function setActiveExercise(exercise: string): Promise<PH3UserProgress> {
  const current = await getUserPH3Progress();
  const updated: PH3UserProgress = {
    ...current,
    activeExercise: exercise,
  };
  await saveUserPH3Progress(updated);
  return updated;
}

/**
 * Marks an exercise as completed in today's session.
 */
export async function markExerciseCompleted(exerciseName: string): Promise<PH3UserProgress> {
  const current = await getUserPH3Progress();
  const normalized = exerciseName.toLowerCase().trim();
  const completed = new Set(current.completedTodayExercises.map((e) => e.toLowerCase().trim()));
  completed.add(normalized);

  const updated: PH3UserProgress = {
    ...current,
    completedTodayExercises: Array.from(completed),
    activeExercise: undefined,
  };
  await saveUserPH3Progress(updated);
  return updated;
}

/**
 * Formats a clean, readable Telegram message displaying today's plan.
 */
export function formatDayPlanMessage(
  plan: PH3DayPlan,
  completedExercises: string[] = [],
  activeExercise?: string
): string {
  const lines: string[] = [
    `🏋️ *PH3 Program — Week ${plan.week}, Day ${plan.day}*`,
    `*${plan.dayTitle}*`,
    `📍 _${plan.blockTab}_`,
    "",
  ];

  if (plan.isRestDay) {
    lines.push("🛌 *Scheduled Rest / Active Recovery Day*");
    lines.push("");
    lines.push("Take today to hydrate, hit your macros, and recover.");
    lines.push("Ready to jump ahead? Tap *Next Training Day* below!");
    return lines.join("\n");
  }

  lines.push("🎯 *Today's Exercises:*");

  plan.exercises.forEach((ex, idx) => {
    const isDone = completedExercises.some(
      (c) => c.toLowerCase().trim() === ex.exercise.toLowerCase().trim()
    );
    const isActive =
      activeExercise &&
      activeExercise.toLowerCase().trim() === ex.exercise.toLowerCase().trim();

    const statusBadge = isDone ? "✅ " : isActive ? "👉 " : "• ";
    const setSummary = ex.sets
      .map((s) => {
        const wStr = s.weight ? `${s.weight}kg ` : "";
        return `${wStr}${s.reps}`;
      })
      .join(", ");

    lines.push(
      `${statusBadge}*${idx + 1}. ${ex.exercise}*` +
        (isDone ? " _(Completed)_" : "")
    );
    lines.push(`   ${ex.sets.length} sets: ${setSummary}`);
  });

  lines.push("");
  if (activeExercise) {
    lines.push(`🔥 *Currently working on:* *${activeExercise}*`);
    lines.push("Reply with your sets, e.g. `95 x 9, 95 x 9`");
  } else {
    lines.push("💬 *Which exercise are you doing right now?*");
    lines.push("Tap an exercise below or tell me what you're doing!");
  }

  return lines.join("\n");
}

/** Formats actual reps the way the sheet's rep column is written: "x8". */
export function formatSheetReps(reps: number): string {
  return `x${reps}`;
}

export interface SheetWriteResult {
  /** The weight landed in the set's weight cell. */
  weight: boolean;
  /** The reps landed in the set's rep cell, replacing the prescribed range. */
  reps: boolean;
}

function cellRange(plan: PH3DayPlan, cell: string): string {
  return `'${plan.blockTab}'!${cell}`;
}

/**
 * Writes the actual weight and reps of a set into the sheet. The weight cell is only filled
 * when empty: prescribed weights (the SBD lifts) are formulas driven by 'Initial Inputs', and
 * previously filled cells are the user's own data. The rep cell holds the prescribed range, so
 * it is replaced with the actual reps only while it still shows that range (or is empty).
 */
export async function writeSetToSheet(params: {
  plan: PH3DayPlan;
  set: PH3ExerciseSet;
  weightKg: number;
  reps: number;
}): Promise<SheetWriteResult> {
  const { plan, set, weightKg, reps } = params;
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const current = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [cellRange(plan, set.weightCell), cellRange(plan, set.repsCell)],
    valueRenderOption: "FORMULA",
  });
  const cellText = (i: number) => String(current.data.valueRanges?.[i]?.values?.[0]?.[0] ?? "").trim();
  const weightFree = cellText(0) === "";
  const repsText = cellText(1);
  const repsFree = repsText === "" || repsText === set.reps.trim();

  const data: Array<{ range: string; values: string[][] }> = [];
  if (weightFree) {
    data.push({ range: cellRange(plan, set.weightCell), values: [[String(Number(weightKg.toFixed(2)))]] });
  }
  if (repsFree) {
    data.push({ range: cellRange(plan, set.repsCell), values: [[formatSheetReps(reps)]] });
  }
  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
    // The cached plan no longer reflects these cells.
    planCache.delete(plan.day);
  }
  return { weight: weightFree, reps: repsFree };
}

/**
 * Overwrites cells this session wrote itself (writeSetToSheet only fills free cells), never
 * prescribed formulas or old data.
 */
export async function overwriteSetCell(params: {
  plan: PH3DayPlan;
  set: PH3ExerciseSet;
  weightKg: number;
  reps: number;
  writeWeight: boolean;
  writeReps: boolean;
}): Promise<void> {
  const { plan, set, weightKg, reps, writeWeight, writeReps } = params;
  const data: Array<{ range: string; values: string[][] }> = [];
  if (writeWeight) {
    data.push({ range: cellRange(plan, set.weightCell), values: [[String(Number(weightKg.toFixed(2)))]] });
  }
  if (writeReps) {
    data.push({ range: cellRange(plan, set.repsCell), values: [[formatSheetReps(reps)]] });
  }
  if (data.length === 0) return;
  await getSheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { valueInputOption: "RAW", data },
  });
  planCache.delete(plan.day);
}

/**
 * Undoes a session write: empties the weight cell and puts the prescribed rep range back.
 * Same restriction as overwriteSetCell.
 */
export async function clearSetCell(params: {
  plan: PH3DayPlan;
  set: PH3ExerciseSet;
  clearWeight: boolean;
  /** The prescribed rep range to restore; omit to leave the rep cell alone. */
  restoreReps?: string;
}): Promise<void> {
  const { plan, set, clearWeight, restoreReps } = params;
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  if (clearWeight) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: cellRange(plan, set.weightCell) });
  }
  if (restoreReps !== undefined) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cellRange(plan, set.repsCell),
      valueInputOption: "RAW",
      requestBody: { values: [[restoreReps]] },
    });
  }
  planCache.delete(plan.day);
}

const MEMORY_SESSION_KEY = "ph3_workout_session";

export async function loadPH3SessionRaw(): Promise<string | null> {
  const record = await getMemoryByKey(MEMORY_SESSION_KEY, "preference");
  return record?.value || null;
}

export async function savePH3SessionRaw(value: string): Promise<void> {
  await saveMemory({
    category: "preference",
    key: MEMORY_SESSION_KEY,
    value,
    tags: ["ph3", "workout", "session"],
  });
}

export async function clearPH3Session(): Promise<void> {
  await deleteMemory(MEMORY_SESSION_KEY);
}
