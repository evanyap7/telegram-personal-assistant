import { getSheetsClient } from "./google";
import { formatSingaporeTimestamp } from "./finance";

const HABITS_SHEET = "Habits";

export interface HabitItem {
  rowNumber: number;
  habitId: string;
  name: string;
  frequency: "daily" | "weekly";
  lastCompletedDate: string; // YYYY-MM-DD
  currentStreak: number;
  bestStreak: number;
  createdAt: string;
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

export function getTodaySingaporeDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
  }).format(new Date());
}

export function getYesterdaySingaporeDate(): string {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
  }).format(yesterday);
}

let habitsSheetEnsured = false;

export async function ensureHabitsSheetExists(): Promise<void> {
  if (habitsSheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const sheetNames = (meta.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);

  if (!sheetNames.includes(HABITS_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: HABITS_SHEET,
              },
            },
          },
        ],
      },
    });

    // Write header
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${HABITS_SHEET}!A1:G1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "Habit ID",
            "Name",
            "Frequency",
            "Last Completed Date",
            "Current Streak",
            "Best Streak",
            "Created At",
          ],
        ],
      },
    });

    // Seed initial default habits
    const initialRows = [
      ["h_read", "Read 20 mins", "daily", "", "0", "0", formatSingaporeTimestamp()],
      ["h_workout", "Workout / Exercise", "daily", "", "0", "0", formatSingaporeTimestamp()],
      ["h_water", "Drink 2L Water", "daily", "", "0", "0", formatSingaporeTimestamp()],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${HABITS_SHEET}!A2:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: initialRows,
      },
    });
  }

  habitsSheetEnsured = true;
}

export async function listHabits(): Promise<HabitItem[]> {
  await ensureHabitsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${HABITS_SHEET}!A2:G`,
  });

  const rows = res.data.values || [];
  const habits: HabitItem[] = [];

  rows.forEach((row, index) => {
    const habitId = String(row[0] || "").trim();
    const name = String(row[1] || "").trim();
    if (!habitId || !name) return;

    habits.push({
      rowNumber: index + 2,
      habitId,
      name,
      frequency: (row[2] as "daily" | "weekly") || "daily",
      lastCompletedDate: String(row[3] || "").trim(),
      currentStreak: parseInt(String(row[4] || "0"), 10) || 0,
      bestStreak: parseInt(String(row[5] || "0"), 10) || 0,
      createdAt: String(row[6] || "").trim(),
    });
  });

  return habits;
}

export async function createHabit(
  name: string,
  frequency: "daily" | "weekly" = "daily"
): Promise<HabitItem> {
  await ensureHabitsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const habitId = `h_${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = formatSingaporeTimestamp();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${HABITS_SHEET}!A2:G`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[habitId, name, frequency, "", "0", "0", createdAt]],
    },
  });

  const habits = await listHabits();
  return (
    habits.find((h) => h.habitId === habitId) || {
      rowNumber: habits.length + 1,
      habitId,
      name,
      frequency,
      lastCompletedDate: "",
      currentStreak: 0,
      bestStreak: 0,
      createdAt,
    }
  );
}

export async function logHabitDone(
  nameOrId: string,
  targetDate?: string
): Promise<{
  success: boolean;
  habit?: HabitItem;
  alreadyDoneToday?: boolean;
  message: string;
}> {
  const habits = await listHabits();
  const searchKey = nameOrId.trim().toLowerCase();

  const habit = habits.find(
    (h) =>
      h.habitId.toLowerCase() === searchKey ||
      h.name.toLowerCase() === searchKey ||
      h.name.toLowerCase().includes(searchKey)
  );

  if (!habit) {
    return {
      success: false,
      message: `Habit "${nameOrId}" not found. Type /habits to see all habits.`,
    };
  }

  const today = targetDate || getTodaySingaporeDate();
  const yesterday = getYesterdaySingaporeDate();

  if (habit.lastCompletedDate === today) {
    return {
      success: true,
      habit,
      alreadyDoneToday: true,
      message: `You already checked off "${habit.name}" today! 🔥 Streak: ${habit.currentStreak} day(s).`,
    };
  }

  let newStreak = 1;
  if (habit.lastCompletedDate === yesterday) {
    newStreak = habit.currentStreak + 1;
  }

  const newBestStreak = Math.max(habit.bestStreak, newStreak);

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Column D: Last Completed Date, E: Current Streak, F: Best Streak
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${HABITS_SHEET}!D${habit.rowNumber}:F${habit.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[today, String(newStreak), String(newBestStreak)]],
    },
  });

  const updatedHabit: HabitItem = {
    ...habit,
    lastCompletedDate: today,
    currentStreak: newStreak,
    bestStreak: newBestStreak,
  };

  const streakEmoji = newStreak >= 7 ? "⚡🔥" : newStreak >= 3 ? "🔥" : "✨";
  return {
    success: true,
    habit: updatedHabit,
    message: `🎯 Checked off "${habit.name}"! ${streakEmoji} Streak: ${newStreak} day(s) (Best: ${newBestStreak}).`,
  };
}

export function formatHabitsSummary(habits: HabitItem[]): {
  text: string;
  buttons: { text: string; callback_data: string }[][];
} {
  const today = getTodaySingaporeDate();

  if (habits.length === 0) {
    return {
      text: "⚡ No habits tracked yet! Add one with `/habit add <name>`.",
      buttons: [],
    };
  }

  const lines = ["🔥 *Daily Habits & Streaks*", ""];
  const pendingButtons: { text: string; callback_data: string }[] = [];

  let completedTodayCount = 0;

  for (const h of habits) {
    const isDone = h.lastCompletedDate === today;
    if (isDone) completedTodayCount++;

    const statusIcon = isDone ? "✅" : "⬜";
    const flame = h.currentStreak > 0 ? ` 🔥 ${h.currentStreak}d` : "";
    const best = h.bestStreak > 1 ? ` (Best: ${h.bestStreak}d)` : "";

    lines.push(`${statusIcon} *${h.name}*${flame}${best}`);

    if (!isDone) {
      pendingButtons.push({
        text: `Check ${h.name.length > 18 ? h.name.slice(0, 17) + "…" : h.name}`,
        callback_data: `habit_done:${h.habitId}`,
      });
    }
  }

  lines.push("");
  lines.push(`Progress: ${completedTodayCount}/${habits.length} completed today.`);

  // Group buttons into rows of 2
  const buttonRows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < pendingButtons.length; i += 2) {
    buttonRows.push(pendingButtons.slice(i, i + 2));
  }

  return {
    text: lines.join("\n"),
    buttons: buttonRows,
  };
}
