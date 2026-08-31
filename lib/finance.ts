import { getSheetsClient } from "./google";

const SHEET_NAME = "Transactions";

export type TransactionInput = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  description: string;
};

function createTransactionId(): string {
  return `txn_${crypto.randomUUID()}`;
}

export async function addTransaction(input: TransactionInput) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  const transactionId = createTransactionId();
  const timestamp = new Date().toISOString();

  const sheets = getSheetsClient();

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
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:G`,
  });

  return response.data.values ?? [];
}