import { getSheetsClient } from "./google";

const SHEET_NAME = "Transactions";
const UPDATE_LOG_SHEET_NAME = "UpdateLog";

export type TransactionInput = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  description: string;
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  return spreadsheetId;
}

function createTransactionId(): string {
  return `txn_${crypto.randomUUID()}`;
}

export async function addTransaction(input: TransactionInput) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const transactionId = createTransactionId();
  const timestamp = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          transactionId,
          timestamp,
          input.type,
          input.amount,
          input.currency.toUpperCase(),
          input.category,
          input.description,
        ],
      ],
    },
  });

  return {
    transactionId,
    timestamp,
  };
}

export async function listRecentTransactions() {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:G`,
  });

  return response.data.values ?? [];
}

export async function hasProcessedUpdate(updateId: number): Promise<boolean> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET_NAME}!A2:A`,
  });

  const existingIds = response.data.values ?? [];

  return existingIds.some((row) => row[0] === String(updateId));
}

export async function markUpdateStarted(updateId: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET_NAME}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          String(updateId),
          "processing",
          new Date().toISOString(),
          "",
          "",
          "",
        ],
      ],
    },
  });
}

export async function markUpdateCompleted(
  updateId: number,
  action: string
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === String(updateId));

  if (rowIndex === -1) {
    return;
  }

  const sheetRowNumber = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET_NAME}!B${sheetRowNumber}:F${sheetRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          "completed",
          rows[rowIndex][2] ?? "",
          new Date().toISOString(),
          action,
          "",
        ],
      ],
    },
  });
}

export async function markUpdateFailed(
  updateId: number,
  errorMessage: string
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === String(updateId));

  if (rowIndex === -1) {
    return;
  }

  const sheetRowNumber = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET_NAME}!B${sheetRowNumber}:F${sheetRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          "failed",
          rows[rowIndex][2] ?? "",
          new Date().toISOString(),
          "",
          errorMessage.slice(0, 500),
        ],
      ],
    },
  });
}