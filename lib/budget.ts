import { getSheetsClient, withExponentialBackoff } from "./google";
import { parseSingaporeDate } from "./date-parser";

export const DEFAULT_MONTHLY_BUDGET = 500;
export const BUDGET_START_MONTH = process.env.BUDGET_START_MONTH || "2026-10";
export const BUDGET_CURRENCY = "SGD";

const BUDGET_CONFIG_SHEET = "BudgetConfig";

export interface CategoryCapStatus {
  category: string;
  cap: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  isOverCap: boolean;
}

export interface MonthlyBudgetStatus {
  hasBudget: boolean;
  budget: number;
  totalExpenses: number;
  remaining: number;
  currency: string;
  monthName: string;
  percentUsed: number;
  isOverBudget: boolean;
  thresholdCrossed?: 50 | 80 | 100;
  categoryCaps?: CategoryCapStatus[];
  categoryCapAlerts?: string[];
  formattedNotice: string;
  formattedMarkdownNotice: string;
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

let configSheetEnsured = false;

export async function ensureBudgetConfigSheetExists(): Promise<void> {
  if (configSheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets?.some(
      (s) => s.properties?.title === BUDGET_CONFIG_SHEET
    );

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: BUDGET_CONFIG_SHEET,
                  gridProperties: {
                    frozenRowCount: 1,
                  },
                },
              },
            },
          ],
        },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${BUDGET_CONFIG_SHEET}!A1:C1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Key", "Value", "UpdatedAt"]],
        },
      });
    }

    configSheetEnsured = true;
  } catch (error) {
    console.error("Failed to ensure BudgetConfig sheet exists:", error);
  }
}

export async function getEffectiveMonthlyBudget(): Promise<number> {
  try {
    await ensureBudgetConfigSheetExists();
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${BUDGET_CONFIG_SHEET}!A2:B`,
    });

    const rows = res.data.values ?? [];
    for (const row of rows) {
      if (row[0] === "overall_budget" && row[1]) {
        const val = parseFloat(row[1]);
        if (!Number.isNaN(val) && val > 0) return val;
      }
    }
  } catch (err) {
    console.warn("Could not read dynamic budget config, using default:", err);
  }

  return Number(process.env.MONTHLY_BUDGET) || DEFAULT_MONTHLY_BUDGET;
}

export async function setEffectiveMonthlyBudget(amount: number): Promise<void> {
  await ensureBudgetConfigSheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUDGET_CONFIG_SHEET}!A2:B`,
  });

  const rows = res.data.values ?? [];
  let foundRowIndex = -1;

  rows.forEach((row, idx) => {
    if (row[0] === "overall_budget") {
      foundRowIndex = idx + 2;
    }
  });

  const nowIso = new Date().toISOString();

  if (foundRowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BUDGET_CONFIG_SHEET}!B${foundRowIndex}:C${foundRowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[String(amount), nowIso]],
      },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${BUDGET_CONFIG_SHEET}!A:C`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["overall_budget", String(amount), nowIso]],
      },
    });
  }
}

export async function getCategoryCaps(): Promise<Record<string, number>> {
  const caps: Record<string, number> = {};
  try {
    await ensureBudgetConfigSheetExists();
    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${BUDGET_CONFIG_SHEET}!A2:B`,
    });

    const rows = res.data.values ?? [];
    for (const row of rows) {
      const key = row[0] || "";
      if (key.startsWith("category_cap:") && row[1]) {
        const category = key.slice("category_cap:".length).trim();
        const val = parseFloat(row[1]);
        if (category && !Number.isNaN(val) && val > 0) {
          caps[category.toLowerCase()] = val;
        }
      }
    }
  } catch (err) {
    console.warn("Could not read category caps:", err);
  }
  return caps;
}

export async function setCategoryCap(category: string, amount: number): Promise<void> {
  await ensureBudgetConfigSheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const targetKey = `category_cap:${category.trim().toLowerCase()}`;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${BUDGET_CONFIG_SHEET}!A2:B`,
  });

  const rows = res.data.values ?? [];
  let foundRowIndex = -1;

  rows.forEach((row, idx) => {
    if (row[0] === targetKey) {
      foundRowIndex = idx + 2;
    }
  });

  const nowIso = new Date().toISOString();

  if (foundRowIndex > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${BUDGET_CONFIG_SHEET}!B${foundRowIndex}:C${foundRowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[String(amount), nowIso]],
      },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${BUDGET_CONFIG_SHEET}!A:C`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[targetKey, String(amount), nowIso]],
      },
    });
  }
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function getMonthSheetNameFromDate(date?: Date | string | number | null): string {
  const safeDate = parseSingaporeDate(date);
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    month: "numeric",
    year: "numeric",
  }).formatToParts(safeDate);

  const monthNum = parseInt(parts.find((p) => p.type === "month")?.value ?? "1", 10);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = SHORT_MONTHS[monthNum - 1] ?? "Sep";
  return `${month} ${year}`;
}

export function isBudgetActiveForDate(date?: Date | string | number | null): boolean {
  const safeDate = parseSingaporeDate(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
  }).format(safeDate);

  return parts >= BUDGET_START_MONTH;
}

export function isBudgetActiveForSheet(sheetName: string): boolean {
  if (!sheetName) return false;
  const match = sheetName.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!match) return false;

  const [, monthStr, yearStr] = match;
  const key = monthStr.toLowerCase().slice(0, 3);
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
  };
  const m = months[key] || "01";
  const yearMonth = `${yearStr}-${m}`;
  return yearMonth >= BUDGET_START_MONTH;
}

export async function getMonthlyBudgetStatus(
  sheetName?: string,
  date?: Date | string | number | null
): Promise<MonthlyBudgetStatus> {
  const targetSheet = sheetName || getMonthSheetNameFromDate(date);
  const hasBudget = isBudgetActiveForSheet(targetSheet);

  const [budget, categoryCapsMap] = await Promise.all([
    getEffectiveMonthlyBudget(),
    getCategoryCaps(),
  ]);

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  let totalExpenses = 0;
  let currency = BUDGET_CURRENCY;
  const categorySpentMap: Record<string, number> = {};

  try {
    const response = await withExponentialBackoff(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${targetSheet}'!A2:I`,
      })
    );

    const rows = response.data.values ?? [];
    for (const row of rows) {
      const type = (row[2] ?? "").trim().toLowerCase();
      const status = (row[7] ?? "active").trim().toLowerCase();
      if (type === "expense" && status === "active") {
        const amt = parseFloat(row[3]) || 0;
        totalExpenses += amt;
        const cat = (row[5] ?? "uncategorized").trim().toLowerCase();
        categorySpentMap[cat] = (categorySpentMap[cat] || 0) + amt;

        if (row[4] && row[4].trim().length > 0) {
          currency = row[4].trim().toUpperCase();
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Unable to parse range")) {
      console.warn(`Could not read transactions from sheet ${targetSheet}:`, err);
    }
  }

  const remaining = budget - totalExpenses;
  const percentUsed = budget > 0 ? (totalExpenses / budget) * 100 : 0;
  const isOverBudget = remaining < 0;

  let thresholdCrossed: 50 | 80 | 100 | undefined;
  if (percentUsed >= 100) thresholdCrossed = 100;
  else if (percentUsed >= 80) thresholdCrossed = 80;
  else if (percentUsed >= 50) thresholdCrossed = 50;

  // Compute category caps status
  const categoryCaps: CategoryCapStatus[] = [];
  const categoryCapAlerts: string[] = [];

  for (const [catKey, cap] of Object.entries(categoryCapsMap)) {
    const spent = categorySpentMap[catKey] || 0;
    const catRemaining = cap - spent;
    const catPercent = cap > 0 ? (spent / cap) * 100 : 0;
    const isOverCap = catRemaining < 0;

    const prettyCat = catKey.charAt(0).toUpperCase() + catKey.slice(1);
    categoryCaps.push({
      category: prettyCat,
      cap,
      spent,
      remaining: catRemaining,
      percentUsed: catPercent,
      isOverCap,
    });

    if (isOverCap) {
      categoryCapAlerts.push(
        `🚨 Cap exceeded: ${prettyCat} $${spent.toFixed(2)} / $${cap.toFixed(2)}`
      );
    } else if (catPercent >= 80) {
      categoryCapAlerts.push(
        `⚠️ Near cap: ${prettyCat} at ${catPercent.toFixed(0)}% ($${spent.toFixed(2)} / $${cap.toFixed(2)})`
      );
    }
  }

  let formattedNotice = "";
  let formattedMarkdownNotice = "";

  if (hasBudget) {
    if (isOverBudget) {
      const overBy = Math.abs(remaining).toFixed(2);
      formattedNotice = `🚨 Budget exceeded: -$${overBy} / $${budget.toFixed(2)} ($${totalExpenses.toFixed(2)} spent)`;
      formattedMarkdownNotice = `🚨 *Budget exceeded:* -$${overBy} / $${budget.toFixed(2)} ($${totalExpenses.toFixed(2)} spent)`;
    } else {
      const rem = remaining.toFixed(2);
      formattedNotice = `💰 Budget: $${rem} / $${budget.toFixed(2)} left to spend`;
      formattedMarkdownNotice = `💰 *Budget:* $${rem} / $${budget.toFixed(2)} left to spend`;
    }
  }

  return {
    hasBudget,
    budget,
    totalExpenses,
    remaining,
    currency,
    monthName: targetSheet,
    percentUsed,
    isOverBudget,
    thresholdCrossed,
    categoryCaps,
    categoryCapAlerts,
    formattedNotice,
    formattedMarkdownNotice,
  };
}

export async function formatBudgetSummary(monthArg?: string): Promise<string> {
  const now = new Date();
  let targetSheet: string;

  if (monthArg && monthArg.trim().length > 0) {
    targetSheet = monthArg.trim();
  } else {
    targetSheet = getMonthSheetNameFromDate(now);
  }

  const status = await getMonthlyBudgetStatus(targetSheet, now);

  if (!status.hasBudget) {
    return [
      `📊 *${status.monthName} Financial Overview*`,
      "",
      `💸 *Total Expenses:* $${status.totalExpenses.toFixed(2)} ${status.currency}`,
      `📝 *Status:* Historical baseline period (no active cap)`,
      "",
      `🎯 *Upcoming Budget:* A *$${status.budget.toFixed(2)}/mo* budget is configured.`,
    ].join("\n");
  }

  const total = status.totalExpenses.toFixed(2);
  const budget = status.budget.toFixed(2);
  const remaining = status.remaining.toFixed(2);

  const totalBlocks = 10;
  const filledBlocks = Math.min(
    totalBlocks,
    Math.max(0, Math.round((status.percentUsed / 100) * totalBlocks))
  );
  const emptyBlocks = totalBlocks - filledBlocks;
  const bar = "▓".repeat(filledBlocks) + "░".repeat(emptyBlocks);

  const statusIcon = status.isOverBudget
    ? "🚨 *Status:* Over budget!"
    : status.percentUsed > 85
    ? "⚠️ *Status:* Approaching budget limit!"
    : "✅ *Status:* On track";

  const lines = [
    `📊 *Monthly Budget Overview (${status.monthName})*`,
    "",
    `🎯 *Budget Cap:* $${budget} ${status.currency}`,
    `💸 *Total Spent:* $${total} ${status.currency}`,
    status.isOverBudget
      ? `🚨 *Deficit:* -$${Math.abs(status.remaining).toFixed(2)} / $${budget}`
      : `💰 *Remaining:* $${remaining} / $${budget} left to spend`,
    "",
    `📈 *Utilization:* [${bar}] ${status.percentUsed.toFixed(1)}%`,
    statusIcon,
  ];

  if (status.categoryCaps && status.categoryCaps.length > 0) {
    lines.push("", "🏷️ *Category Caps:*");
    for (const c of status.categoryCaps) {
      const icon = c.isOverCap ? "🚨" : c.percentUsed >= 80 ? "⚠️" : "•";
      lines.push(
        `  ${icon} *${c.category}:* $${c.spent.toFixed(2)} / $${c.cap.toFixed(2)} (${c.percentUsed.toFixed(0)}%)`
      );
    }
  }

  return lines.join("\n");
}
