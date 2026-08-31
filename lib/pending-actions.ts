import { getSheetsClient } from "./google";

const SHEET_NAME = "PendingActions";
const EXPIRY_MS = 5 * 60 * 1000;

export type CalendarAddPayload = {
  calendarName: "personal" | "work";
  title: string;
  start: string;
  end: string;
};

export type FinanceSelectionPayload = {
  transactionIds: string[];
};

export type CalendarSelectionItem = {
  eventId: string;
  title: string;
  start: string;
  end: string;
};

export type CalendarSelectionPayload = {
  calendarName: "personal" | "work";
  events: CalendarSelectionItem[];
};

export type FinanceDeletePayload = {
  transactionId: string;
};

export type CalendarDeletePayload = {
  calendarName: "personal" | "work";
  eventId: string;
};

type PendingActionType =
  | "calendar_add"
  | "finance_select"
  | "calendar_select"
  | "finance_delete"
  | "calendar_delete";

type PendingStatus = "pending" | "selected" | "confirmed" | "cancelled";

type PendingRow = {
  token: string;
  userId: number;
  actionType: PendingActionType;
  payloadJson: string;
  expiresAt: string;
  status: string;
  rowNumber: number;
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  return spreadsheetId;
}

function createToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function isExpired(expiresAt: string): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();

  return Number.isNaN(expiresAtMs) || expiresAtMs < Date.now();
}

async function savePendingAction(input: {
  userId: number;
  actionType: PendingActionType;
  payload: unknown;
  status?: PendingStatus;
}): Promise<string> {
  const token = createToken();
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          token,
          String(input.userId),
          input.actionType,
          JSON.stringify(input.payload),
          new Date(Date.now() + EXPIRY_MS).toISOString(),
          input.status ?? "pending",
        ],
      ],
    },
  });

  return token;
}

async function findPendingRow(token: string): Promise<PendingRow | null> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === token);

  if (rowIndex === -1) {
    return null;
  }

  const row = rows[rowIndex];

  return {
    token: row[0] ?? "",
    userId: Number(row[1]),
    actionType: (row[2] ?? "") as PendingActionType,
    payloadJson: row[3] ?? "",
    expiresAt: row[4] ?? "",
    status: row[5] ?? "",
    rowNumber: rowIndex + 2,
  };
}

async function setPendingStatus(
  rowNumber: number,
  status: PendingStatus
): Promise<void> {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!F${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[status]],
    },
  });
}

function parsePayload<T>(payloadJson: string): T {
  try {
    return JSON.parse(payloadJson) as T;
  } catch {
    throw new Error("Stored confirmation data is invalid.");
  }
}

async function takePendingAction<T>(input: {
  token: string;
  userId: number;
  actionType: PendingActionType;
  allowedStatuses?: PendingStatus[];
  nextStatus?: PendingStatus;
}): Promise<{ payload: T; rowNumber: number } | null> {
  const row = await findPendingRow(input.token);

  if (
    !row ||
    row.userId !== input.userId ||
    row.actionType !== input.actionType ||
    isExpired(row.expiresAt) ||
    !(input.allowedStatuses ?? ["pending"]).includes(
      row.status as PendingStatus
    )
  ) {
    return null;
  }

  const payload = parsePayload<T>(row.payloadJson);

  if (input.nextStatus) {
    await setPendingStatus(row.rowNumber, input.nextStatus);
  }

  return {
    payload,
    rowNumber: row.rowNumber,
  };
}

async function cancelPendingAction(input: {
  token: string;
  userId: number;
  actionType: PendingActionType;
  allowedStatuses?: PendingStatus[];
}): Promise<boolean> {
  const row = await findPendingRow(input.token);

  if (
    !row ||
    row.userId !== input.userId ||
    row.actionType !== input.actionType ||
    isExpired(row.expiresAt) ||
    !(input.allowedStatuses ?? ["pending"]).includes(
      row.status as PendingStatus
    )
  ) {
    return false;
  }

  await setPendingStatus(row.rowNumber, "cancelled");

  return true;
}

export async function savePendingCalendarAction(input: {
  userId: number;
  payload: CalendarAddPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_add",
    payload: input.payload,
  });
}

export async function takePendingCalendarAction(
  token: string,
  userId: number
): Promise<{ payload: CalendarAddPayload } | null> {
  const result = await takePendingAction<CalendarAddPayload>({
    token,
    userId,
    actionType: "calendar_add",
    nextStatus: "confirmed",
  });

  return result ? { payload: result.payload } : null;
}

export async function cancelPendingCalendarAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "calendar_add",
  });
}

export async function savePendingFinanceSelection(input: {
  userId: number;
  transactionIds: string[];
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "finance_select",
    payload: {
      transactionIds: input.transactionIds,
    } satisfies FinanceSelectionPayload,
  });
}

export async function takePendingFinanceSelection(
  token: string,
  userId: number
): Promise<FinanceSelectionPayload | null> {
  const result = await takePendingAction<FinanceSelectionPayload>({
    token,
    userId,
    actionType: "finance_select",
    nextStatus: "selected",
  });

  return result?.payload ?? null;
}

export async function savePendingCalendarSelection(input: {
  userId: number;
  calendarName: "personal" | "work";
  events: CalendarSelectionItem[];
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_select",
    payload: {
      calendarName: input.calendarName,
      events: input.events,
    } satisfies CalendarSelectionPayload,
  });
}

export async function takePendingCalendarSelection(
  token: string,
  userId: number
): Promise<CalendarSelectionPayload | null> {
  const result = await takePendingAction<CalendarSelectionPayload>({
    token,
    userId,
    actionType: "calendar_select",
    nextStatus: "selected",
  });

  return result?.payload ?? null;
}

export async function savePendingFinanceDeleteAction(input: {
  userId: number;
  payload: FinanceDeletePayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "finance_delete",
    payload: input.payload,
  });
}

export async function takePendingFinanceDeleteAction(
  token: string,
  userId: number
): Promise<FinanceDeletePayload | null> {
  const result = await takePendingAction<FinanceDeletePayload>({
    token,
    userId,
    actionType: "finance_delete",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingFinanceDeleteAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "finance_delete",
  });
}

export async function savePendingCalendarDeleteAction(input: {
  userId: number;
  payload: CalendarDeletePayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_delete",
    payload: input.payload,
  });
}

export async function takePendingCalendarDeleteAction(
  token: string,
  userId: number
): Promise<CalendarDeletePayload | null> {
  const result = await takePendingAction<CalendarDeletePayload>({
    token,
    userId,
    actionType: "calendar_delete",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingCalendarDeleteAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "calendar_delete",
  });
}