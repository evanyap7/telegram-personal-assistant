import { getSheetsClient } from "./google";

const RECURRING_SHEET = "RecurringSchedules";

export type RecurringType = "subscription" | "recurring_task";
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface RecurringSchedule {
  rowNumber: number;
  id: string;
  type: RecurringType;
  title: string;
  amount?: number;
  currency?: string;
  category?: string;
  frequency: RecurringFrequency;
  dayOfMonth?: number;
  dayOfWeek?: number;
  active: boolean;
  lastRunDate?: string;
  nextRunDate: string;
  createdAt: string;
}

export interface AddRecurringInput {
  type: RecurringType;
  title: string;
  amount?: number;
  currency?: string;
  category?: string;
  frequency: RecurringFrequency;
  dayOfMonth?: number;
  dayOfWeek?: number;
  startDate?: string;
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

function createRecurringId(): string {
  return `rec_${crypto.randomUUID().slice(0, 8)}`;
}

let sheetEnsured = false;

export async function ensureRecurringSheetExists(): Promise<void> {
  if (sheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets?.some(
      (s) => s.properties?.title === RECURRING_SHEET
    );

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: RECURRING_SHEET,
                  gridProperties: {
                    frozenRowCount: 1,
                  },
                },
              },
            },
          ],
        },
      });

      const headers = [
        "ID",
        "Type",
        "Title",
        "Amount",
        "Currency",
        "Category",
        "Frequency",
        "DayOfMonth",
        "DayOfWeek",
        "Active",
        "LastRunDate",
        "NextRunDate",
        "CreatedAt",
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${RECURRING_SHEET}!A1:M1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [headers],
        },
      });
    }

    sheetEnsured = true;
  } catch (error) {
    console.error("Failed to ensure RecurringSchedules sheet exists:", error);
  }
}

export function computeNextRunDate(
  frequency: RecurringFrequency,
  dayOfMonth?: number,
  dayOfWeek?: number,
  fromDate: Date = new Date()
): string {
  const year = fromDate.getFullYear();
  const month = fromDate.getMonth();
  const date = fromDate.getDate();

  const pad = (n: number) => String(n).padStart(2, "0");

  if (frequency === "daily") {
    const next = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  }

  if (frequency === "weekly") {
    const targetDay = dayOfWeek ?? fromDate.getDay();
    let daysUntil = (targetDay - fromDate.getDay() + 7) % 7;
    if (daysUntil === 0) daysUntil = 7;
    const next = new Date(fromDate.getTime() + daysUntil * 24 * 60 * 60 * 1000);
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  }

  if (frequency === "monthly") {
    const targetDom = Math.min(28, Math.max(1, dayOfMonth ?? date));
    let nextMonth = month;
    let nextYear = year;

    if (date >= targetDom) {
      nextMonth += 1;
      if (nextMonth > 11) {
        nextMonth = 0;
        nextYear += 1;
      }
    }
    return `${nextYear}-${pad(nextMonth + 1)}-${pad(targetDom)}`;
  }

  // yearly
  const targetDom = Math.min(28, Math.max(1, dayOfMonth ?? date));
  const nextYear = year + 1;
  return `${nextYear}-${pad(month + 1)}-${pad(targetDom)}`;
}

export async function listRecurringSchedules(options: {
  type?: RecurringType;
  activeOnly?: boolean;
} = {}): Promise<RecurringSchedule[]> {
  await ensureRecurringSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RECURRING_SHEET}!A2:M`,
  });

  const rows = res.data.values ?? [];
  const schedules: RecurringSchedule[] = [];

  rows.forEach((row, index) => {
    const id = row[0];
    if (!id) return;

    const type = (row[1] || "subscription") as RecurringType;
    const active = String(row[9]).toLowerCase() !== "false";

    if (options.type && type !== options.type) return;
    if (options.activeOnly && !active) return;

    schedules.push({
      rowNumber: index + 2,
      id,
      type,
      title: row[2] || "",
      amount: row[3] ? parseFloat(row[3]) : undefined,
      currency: row[4] || "SGD",
      category: row[5] || undefined,
      frequency: (row[6] || "monthly") as RecurringFrequency,
      dayOfMonth: row[7] ? parseInt(row[7], 10) : undefined,
      dayOfWeek: row[8] ? parseInt(row[8], 10) : undefined,
      active,
      lastRunDate: row[10] || undefined,
      nextRunDate: row[11] || "",
      createdAt: row[12] || "",
    });
  });

  return schedules;
}

export async function addRecurringSchedule(
  input: AddRecurringInput
): Promise<RecurringSchedule> {
  await ensureRecurringSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const id = createRecurringId();
  const now = new Date();
  const createdAt = now.toISOString();

  const nextRunDate = input.startDate || computeNextRunDate(
    input.frequency,
    input.dayOfMonth,
    input.dayOfWeek,
    now
  );

  const row = [
    id,
    input.type,
    input.title,
    input.amount !== undefined ? String(input.amount) : "",
    input.currency || "SGD",
    input.category || "Subscriptions",
    input.frequency,
    input.dayOfMonth !== undefined ? String(input.dayOfMonth) : "",
    input.dayOfWeek !== undefined ? String(input.dayOfWeek) : "",
    "TRUE",
    "",
    nextRunDate,
    createdAt,
  ];

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${RECURRING_SHEET}!A:M`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });

  const updatedRange = appendRes.data.updates?.updatedRange || "";
  const match = updatedRange.match(/!A(\d+)/);
  const rowNumber = match ? parseInt(match[1], 10) : 2;

  return {
    rowNumber,
    id,
    type: input.type,
    title: input.title,
    amount: input.amount,
    currency: input.currency || "SGD",
    category: input.category || "Subscriptions",
    frequency: input.frequency,
    dayOfMonth: input.dayOfMonth,
    dayOfWeek: input.dayOfWeek,
    active: true,
    nextRunDate,
    createdAt,
  };
}

export async function updateRecurringScheduleRun(
  id: string,
  lastRunDate: string,
  nextRunDate: string
): Promise<boolean> {
  const schedules = await listRecurringSchedules();
  const target = schedules.find((s) => s.id === id);
  if (!target) return false;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${RECURRING_SHEET}!K${target.rowNumber}:L${target.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[lastRunDate, nextRunDate]],
    },
  });

  return true;
}

export async function toggleRecurringSchedule(
  id: string,
  active: boolean
): Promise<boolean> {
  const schedules = await listRecurringSchedules();
  const target = schedules.find((s) => s.id === id);
  if (!target) return false;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${RECURRING_SHEET}!J${target.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[active ? "TRUE" : "FALSE"]],
    },
  });

  return true;
}
