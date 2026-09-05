import { getSheetsClient } from "./google";

const TRANSACTIONS_SHEET = "Transactions";
const UPDATE_LOG_SHEET = "UpdateLog";

export type TransactionInput = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  description: string;
  transactionDate?: string;
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

function formatSingaporeTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const day = getPart("day");
  const month = getPart("month");
  const year = getPart("year");
  const hour = getPart("hour");
  const minute = getPart("minute");
  const dayPeriod = getPart("dayPeriod").toUpperCase();

  return `${day} ${month} ${year} @ ${hour}:${minute} ${dayPeriod}`;
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
  let dateObj = new Date();
  if (input.transactionDate) {
    const parsedDate = new Date(`${input.transactionDate}T12:00:00+08:00`);
    if (!Number.isNaN(parsedDate.getTime())) {
      dateObj = parsedDate;
    }
  }
  const timestamp = formatSingaporeTimestamp(dateObj);

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

export async function addTransactionsBatch(
  items: TransactionInput[]
): Promise<Array<{ transactionId: string; timestamp: string }>> {
  if (items.length === 0) return [];

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const results: Array<{ transactionId: string; timestamp: string }> = [];
  const rows: (string | number)[][] = [];

  for (const input of items) {
    const transactionId = createTransactionId();
    let dateObj = new Date();
    if (input.transactionDate) {
      const parsedDate = new Date(`${input.transactionDate}T12:00:00+08:00`);
      if (!Number.isNaN(parsedDate.getTime())) {
        dateObj = parsedDate;
      }
    }
    const timestamp = formatSingaporeTimestamp(dateObj);

    results.push({ transactionId, timestamp });
    rows.push([
      transactionId,
      timestamp,
      input.type,
      input.amount,
      input.currency.toUpperCase(),
      input.category,
      input.description,
      "active",
      "",
    ]);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TRANSACTIONS_SHEET}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows,
    },
  });

  return results;
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

export type CategorySpending = {
  category: string;
  amount: number;
  percentage: number;
};

export type FinanceSummary = {
  period: "today" | "week" | "month" | "all";
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
  currency: string;
  transactionCount: number;
  categories: CategorySpending[];
};

function parseSingaporeTimestamp(str: string): Date | null {
  if (!str) return null;
  const trimmed = str.trim();

  const match = trimmed.match(
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s*@|\s+)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );

  if (match) {
    const [, dayStr, monthStr, yearStr, hourStr, minStr, secStr, ampm] = match;
    const months: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };

    const monthKey = monthStr.toLowerCase();
    const month = months[monthKey];

    if (month !== undefined) {
      let hour = parseInt(hourStr, 10);
      if (ampm) {
        if (ampm.toUpperCase() === "PM" && hour < 12) hour += 12;
        if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;
      }
      const day = parseInt(dayStr, 10);
      const min = parseInt(minStr, 10);
      const sec = secStr ? parseInt(secStr, 10) : 0;
      const year = parseInt(yearStr, 10);

      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}+08:00`;
      const date = new Date(iso);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const date = new Date(`${trimmed}T12:00:00+08:00`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

export async function getFinanceSummary(
  period: "today" | "week" | "month" | "all" = "month"
): Promise<FinanceSummary> {
  const transactions = await listRecentTransactions();

  const now = new Date();
  const sgToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const sgCurrentMonth = sgToday.slice(0, 7);
  const todaySgMidnight = new Date(`${sgToday}T00:00:00+08:00`);
  const sevenDaysAgoMidnight = new Date(
    todaySgMidnight.getTime() - 7 * 24 * 60 * 60 * 1000
  );

  const filtered = transactions.filter((txn) => {
    if (period === "all") return true;

    const txnDate = parseSingaporeTimestamp(txn.timestamp);
    if (!txnDate) return false;

    const txnSgDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(txnDate);

    if (period === "today") {
      return txnSgDate === sgToday;
    }

    if (period === "month") {
      return txnSgDate.startsWith(sgCurrentMonth);
    }

    if (period === "week") {
      return txnDate >= sevenDaysAgoMidnight;
    }

    return true;
  });

  let totalIncome = 0;
  let totalExpense = 0;
  const categoryMap: Record<string, number> = {};
  let defaultCurrency = "SGD";

  for (const txn of filtered) {
    const amount = parseFloat(txn.amount) || 0;
    if (txn.currency) {
      defaultCurrency = txn.currency.toUpperCase();
    }

    if (txn.type.toLowerCase() === "income") {
      totalIncome += amount;
    } else {
      totalExpense += amount;
      const category = txn.category.trim() || "Uncategorized";
      categoryMap[category] = (categoryMap[category] || 0) + amount;
    }
  }

  const categories: CategorySpending[] = Object.entries(categoryMap)
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period,
    totalIncome,
    totalExpense,
    netSavings: totalIncome - totalExpense,
    currency: defaultCurrency,
    transactionCount: filtered.length,
    categories,
  };
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