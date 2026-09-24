import { getSheetsClient, withExponentialBackoff } from "./google";
import { parseSingaporeDate } from "./date-parser";

export const DEFAULT_MONTHLY_BUDGET = 500;
export const BUDGET_START_MONTH = process.env.BUDGET_START_MONTH || "2026-10";
export const BUDGET_CURRENCY = "SGD";

export interface MonthlyBudgetStatus {
  hasBudget: boolean;
  budget: number;
  totalExpenses: number;
  remaining: number;
  currency: string;
  monthName: string;
  percentUsed: number;
  isOverBudget: boolean;
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

/**
 * Checks whether the $500 budget is active for a given date or month string.
 * Defaults to starting from October 2026 (2026-10).
 */
export function isBudgetActiveForDate(date?: Date | string | number | null): boolean {
  const safeDate = parseSingaporeDate(date);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
  }).format(safeDate); // e.g. "2026-09" or "2026-10"

  return parts >= BUDGET_START_MONTH;
}

/**
 * Checks whether budget is active for a specific month sheet name (e.g. "Oct 2026").
 */
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

/**
 * Calculates monthly budget status for a given sheet and date.
 */
export async function getMonthlyBudgetStatus(
  sheetName?: string,
  date?: Date | string | number | null
): Promise<MonthlyBudgetStatus> {
  const targetSheet = sheetName || getMonthSheetNameFromDate(date);
  const hasBudget = isBudgetActiveForSheet(targetSheet);
  const budget = Number(process.env.MONTHLY_BUDGET) || DEFAULT_MONTHLY_BUDGET;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  let totalExpenses = 0;
  let currency = BUDGET_CURRENCY;

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
        if (row[4] && row[4].trim().length > 0) {
          currency = row[4].trim().toUpperCase();
        }
      }
    }
  } catch (err: unknown) {
    // If the sheet does not exist yet (e.g. at the start of a future month), total is 0
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("Unable to parse range")) {
      console.warn(`Could not read transactions from sheet ${targetSheet}:`, err);
    }
  }

  const remaining = budget - totalExpenses;
  const percentUsed = budget > 0 ? (totalExpenses / budget) * 100 : 0;
  const isOverBudget = remaining < 0;

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
    formattedNotice,
    formattedMarkdownNotice,
  };
}

/**
 * Generates an executive visual progress bar and text summary for the /budget command.
 */
export async function formatBudgetSummary(monthArg?: string): Promise<string> {
  const now = new Date();
  let targetSheet: string;

  if (monthArg && monthArg.trim().length > 0) {
    targetSheet = monthArg.trim();
  } else {
    // If we are currently in September but budget starts in October,
    // let's show October if requested or current month with next month preview!
    targetSheet = getMonthSheetNameFromDate(now);
  }

  const status = await getMonthlyBudgetStatus(targetSheet, now);

  if (!status.hasBudget) {
    // Current month is prior to budget start (e.g. Sep 2026 baseline)
    return [
      `📊 *${status.monthName} Financial Overview*`,
      "",
      `💸 *Total Expenses:* $${status.totalExpenses.toFixed(2)} ${status.currency}`,
      `📝 *Status:* Historical baseline period (no active cap)`,
      "",
      `🎯 *Upcoming Budget:* A *$${DEFAULT_MONTHLY_BUDGET.toFixed(2)}/mo* budget will be active starting *1 Oct 2026*.`,
      `💬 Every time an expense is logged in October onwards, the assistant will automatically report how much you have left to spend / $500!`,
    ].join("\n");
  }

  // Active budget period (e.g. Oct 2026 onwards)
  const total = status.totalExpenses.toFixed(2);
  const budget = status.budget.toFixed(2);
  const remaining = status.remaining.toFixed(2);

  // Generate ASCII progress bar [▓▓▓░░░░░░░]
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

  return [
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
  ].join("\n");
}
