import { getSheetsClient } from "./google";

const TRANSACTIONS_SHEET = "Transactions";
const UPDATE_LOG_SHEET = "UpdateLog";

export type TransactionInput = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  description: string;
};

export type FinanceTransaction = {
  rowNumber: number;
  transactionId: string;
  timestamp: string;
  type: string;
  amount: string;
  currency: string;
  category: string;
  description: string;
  status: string;
  deletedAt: string;
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

function normaliseCell(value: string | undefined): string {
  return value?.trim() ?? "";
}

function rowToTransaction(
  row: string[],
  rowNumber: number
): FinanceTransaction {
  return {
    rowNumber,
    transactionId: normaliseCell(row[0]),
    timestamp: normaliseCell(row[1]),
    type: normaliseCell(row[2]),
    amount: normaliseCell(row[3]),
    currency: normaliseCell(row[4]),
    category: normaliseCell(row[5]),
    description: normaliseCell(row[6]),
    status: normaliseCell(row[7]) || "active",
    deletedAt: normaliseCell(row[8]),
  };
}

export async function addTransaction(input: TransactionInput): Promise<{
  transactionId: string;
  timestamp: string;
}> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const transactionId = createTransactionId();
  const timestamp = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TRANSACTIONS_SHEET}!A:I`,
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
          "active",
          "",
        ],
      ],
    },
  });

  return {
    transactionId,
    timestamp,
  };
}

export async function listRecentTransactions(): Promise<FinanceTransaction[]> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TRANSACTIONS_SHEET}!A2:I`,
  });

  const rows = response.data.values ?? [];

  return rows
    .map((row, index) => rowToTransaction(row, index + 2))
    .filter((transaction) => transaction.status.toLowerCase() === "active");
}

export async function searchActiveTransactions(
  query: string
): Promise<FinanceTransaction[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const transactions = await listRecentTransactions();

  if (!normalizedQuery) {
    return transactions.slice(-10).reverse();
  }

  return transactions
    .filter((transaction) => {
      const searchableText = [
        transaction.transactionId,
        transaction.type,
        transaction.amount,
        transaction.currency,
        transaction.category,
        transaction.description,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedQuery);
    })
    .slice(-10)
    .reverse();
}

export async function softDeleteTransaction(
  transactionId: string
): Promise<FinanceTransaction | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TRANSACTIONS_SHEET}!A2:I`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => {
    const rowTransactionId = normaliseCell(row[0]);
    const rowStatus = normaliseCell(row[7]) || "active";

    return (
      rowTransactionId === transactionId &&
      rowStatus.toLowerCase() === "active"
    );
  });

  if (rowIndex === -1) {
    return null;
  }

  const rowNumber = rowIndex + 2;
  const transaction = rowToTransaction(rows[rowIndex], rowNumber);
  const deletedAt = new Date().toISOString();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TRANSACTIONS_SHEET}!H${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["deleted", deletedAt]],
    },
  });

  return {
    ...transaction,
    status: "deleted",
    deletedAt,
  };
}

export async function hasProcessedUpdate(updateId: number): Promise<boolean> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET}!A2:A`,
  });

  const existingIds = response.data.values ?? [];

  return existingIds.some((row) => row[0] === String(updateId));
}

export async function markUpdateStarted(updateId: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET}!A:F`,
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

async function updateLogRow(
  updateId: number,
  values: [string, string, string, string, string]
): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === String(updateId));

  if (rowIndex === -1) {
    return;
  }

  const rowNumber = rowIndex + 2;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${UPDATE_LOG_SHEET}!B${rowNumber}:F${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values],
    },
  });
}

export async function markUpdateCompleted(
  updateId: number,
  action: string
): Promise<void> {
  const now = new Date().toISOString();

  await updateLogRow(updateId, ["completed", now, now, action, ""]);
}

export async function markUpdateFailed(
  updateId: number,
  errorMessage: string
): Promise<void> {
  const now = new Date().toISOString();

  await updateLogRow(updateId, [
    "failed",
    now,
    now,
    "",
    errorMessage.slice(0, 500),
  ]);
}