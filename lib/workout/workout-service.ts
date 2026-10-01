import { getSheetsClient } from "../google";
import { formatSingaporeTimestamp } from "../finance";
import {
  calculateEstimated1RM,
  calculateSessionVolume,
} from "./progressive-overload";
import type {
  GymLocation,
  WorkoutSession,
  WorkoutSet,
} from "./workout-types";

const WORKOUTS_SHEET = "Workouts";

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

let sheetInitialized = false;

export async function ensureWorkoutsSheetExists(): Promise<void> {
  if (sheetInitialized) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === WORKOUTS_SHEET
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: WORKOUTS_SHEET,
                tabColor: { red: 0.15, green: 0.68, blue: 0.38 }, // Emerald green
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
            },
          },
        ],
      },
    });

    // Write header row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${WORKOUTS_SHEET}!A1:M1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "SessionID",
            "Date",
            "Week",
            "Location",
            "Routine",
            "Exercise",
            "SetNumber",
            "WeightKg",
            "Reps",
            "DropSet",
            "Notes",
            "Estimated1RM",
            "VolumeKg",
          ],
        ],
      },
    });
  }

  sheetInitialized = true;
}

export async function logWorkoutSession(
  session: WorkoutSession
): Promise<{ rowIds: string[]; totalVolumeKg: number }> {
  await ensureWorkoutsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const rowsToAppend: (string | number)[][] = [];
  const rowIds: string[] = [];

  session.sets.forEach((set, idx) => {
    const e1rm = calculateEstimated1RM(set.weightKg, set.reps);
    const volume = set.weightKg * set.reps;
    const setId = `${session.sessionId}_set_${idx + 1}`;
    rowIds.push(setId);

    rowsToAppend.push([
      setId,
      session.date,
      session.week || "",
      session.location,
      session.routine,
      set.exercise,
      set.setNumber,
      set.weightKg,
      set.reps,
      set.isDropSet ? "YES" : "NO",
      set.notes || "",
      e1rm,
      volume,
    ]);
  });

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${WORKOUTS_SHEET}!A:M`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rowsToAppend,
    },
  });

  const totalVolumeKg = calculateSessionVolume(session.sets);
  return { rowIds, totalVolumeKg };
}

export async function getRecentWorkoutSetsByLocation(
  location: GymLocation
): Promise<Map<string, WorkoutSet[]>> {
  await ensureWorkoutsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${WORKOUTS_SHEET}!A2:M`,
  });

  const rows = response.data.values ?? [];
  const exerciseMap = new Map<string, WorkoutSet[]>();

  // Filter rows for this location
  const matchingRows = rows.filter(
    (r) => String(r[3] || "").toLowerCase() === location.toLowerCase()
  );

  // Take the most recent session's sets
  if (matchingRows.length === 0) {
    return exerciseMap;
  }

  // Find the latest date/session in matching rows
  const latestDate = matchingRows[matchingRows.length - 1][1];
  const latestSessionRows = matchingRows.filter((r) => r[1] === latestDate);

  for (const r of latestSessionRows) {
    const exercise = String(r[5] || "").toLowerCase().trim();
    const setNum = Number(r[6]) || 1;
    const weight = Number(r[7]) || 0;
    const reps = Number(r[8]) || 0;
    const isDrop = String(r[9] || "").toUpperCase() === "YES";
    const notes = String(r[10] || "");

    const set: WorkoutSet = {
      exercise: String(r[5] || ""),
      setNumber: setNum,
      weightKg: weight,
      reps,
      isDropSet: isDrop,
      notes,
    };

    if (!exerciseMap.has(exercise)) {
      exerciseMap.set(exercise, []);
    }
    exerciseMap.get(exercise)!.push(set);
  }

  return exerciseMap;
}

export async function deleteWorkoutRows(rowIds: string[]): Promise<boolean> {
  if (rowIds.length === 0) return true;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${WORKOUTS_SHEET}!A2:A`,
  });

  const rows = response.data.values ?? [];
  const indicesToDelete: number[] = [];

  rows.forEach((r, idx) => {
    const id = String(r[0] || "");
    if (rowIds.includes(id)) {
      indicesToDelete.push(idx + 2); // 1-indexed, skipping header
    }
  });

  if (indicesToDelete.length === 0) return false;

  // Batch clear rows
  const ranges = indicesToDelete.map(
    (rowNum) => `${WORKOUTS_SHEET}!A${rowNum}:M${rowNum}`
  );

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: {
      ranges,
    },
  });

  return true;
}

export async function getWorkoutStatsSummary(): Promise<{
  totalSessions: number;
  totalVolumeKg: number;
  recentPRs: Array<{ exercise: string; weightKg: number; reps: number; date: string }>;
}> {
  await ensureWorkoutsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${WORKOUTS_SHEET}!A2:M`,
  });

  const rows = response.data.values ?? [];
  const uniqueDates = new Set<string>();
  let totalVolumeKg = 0;
  const maxLiftMap = new Map<string, { weightKg: number; reps: number; date: string; e1rm: number }>();

  for (const r of rows) {
    const date = String(r[1] || "");
    if (!date) continue;
    uniqueDates.add(date);

    const exercise = String(r[5] || "");
    const weight = Number(r[7]) || 0;
    const reps = Number(r[8]) || 0;
    const vol = Number(r[12]) || weight * reps;
    totalVolumeKg += vol;

    const e1rm = calculateEstimated1RM(weight, reps);
    const existing = maxLiftMap.get(exercise);
    if (!existing || e1rm > existing.e1rm) {
      maxLiftMap.set(exercise, { weightKg: weight, reps, date, e1rm });
    }
  }

  const recentPRs = Array.from(maxLiftMap.entries())
    .map(([exercise, data]) => ({
      exercise,
      weightKg: data.weightKg,
      reps: data.reps,
      date: data.date,
    }))
    .slice(0, 6);

  return {
    totalSessions: uniqueDates.size,
    totalVolumeKg: Math.round(totalVolumeKg),
    recentPRs,
  };
}
