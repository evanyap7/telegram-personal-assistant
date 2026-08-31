import { getSheetsClient } from "./google";

const SHEET_NAME = "PendingActions";
const EXPIRY_MS = 5 * 60 * 1000;

export type CalendarAddPayload = {
  calendarName: "personal" | "work";
  title: string;
  start: string;
  end: string;
};

export type PendingCalendarAction = {
  token: string;
  userId: number;
  payload: CalendarAddPayload;
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

export async function savePendingCalendarAction(input: {
  userId: number;
  payload: CalendarAddPayload;
}): Promise<string> {
  const token = createToken();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          token,
          String(input.userId),
          "calendar_add",
          JSON.stringify(input.payload),
          new Date(Date.now() + EXPIRY_MS).toISOString(),
          "pending",
        ],
      ],
    },
  });

  return token;
}

export async function takePendingCalendarAction(
  token: string,
  userId: number
): Promise<PendingCalendarAction | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === token);

  if (rowIndex === -1) {
    return null;
  }

  const row = rows[rowIndex];
  const [storedToken, storedUserId, actionType, payloadJson, expiresAt, status] =
    row;

  const sheetRowNumber = rowIndex + 2;

  if (
    storedUserId !== String(userId) ||
    actionType !== "calendar_add" ||
    status !== "pending" ||
    !expiresAt ||
    new Date(expiresAt).getTime() < Date.now()
  ) {
    return null;
  }

  let payload: CalendarAddPayload;

  try {
    payload = JSON.parse(payloadJson) as CalendarAddPayload;
  } catch {
    throw new Error("Stored calendar confirmation data is invalid.");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!F${sheetRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["confirmed"]],
    },
  });

  return {
    token: storedToken,
    userId,
    payload,
  };
}

export async function cancelPendingCalendarAction(
  token: string,
  userId: number
): Promise<boolean> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === token);

  if (rowIndex === -1) {
    return false;
  }

  const row = rows[rowIndex];
  const [storedToken, storedUserId, actionType, , expiresAt, status] = row;

  const sheetRowNumber = rowIndex + 2;

  if (
    storedToken !== token ||
    storedUserId !== String(userId) ||
    actionType !== "calendar_add" ||
    status !== "pending" ||
    !expiresAt ||
    new Date(expiresAt).getTime() < Date.now()
  ) {
    return false;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!F${sheetRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["cancelled"]],
    },
  });

  return true;
}