import { getSheetsClient } from "./google";
import { formatSingaporeTimestamp } from "./finance";

const IOUS_SHEET = "IOUs";

export interface BillSplitItem {
  name: string;
  amount: number;
}

export interface BillSplitResult {
  totalAmount: number;
  subtotal: number;
  tipAmount: number;
  taxAmount: number;
  perPersonShare: number;
  shares: BillSplitItem[];
}

export interface IOURecord {
  rowNumber: number;
  iouId: string;
  createdAt: string;
  payer: string;
  debtor: string;
  amount: number;
  currency: string;
  description: string;
  status: "unsettled" | "settled";
  settledAt?: string;
}

export interface AddIOUInput {
  payer?: string;
  debtor: string;
  amount: number;
  currency?: string;
  description?: string;
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

function createIOUId(): string {
  return `iou_${crypto.randomUUID().slice(0, 8)}`;
}

let sheetEnsured = false;

async function ensureIOUsSheetExists(): Promise<void> {
  if (sheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const sheetNames = (meta.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);

  if (!sheetNames.includes(IOUS_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: IOUS_SHEET,
              },
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${IOUS_SHEET}!A1:I1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "iou_id",
            "created_at",
            "payer",
            "debtor",
            "amount",
            "currency",
            "description",
            "status",
            "settled_at",
          ],
        ],
      },
    });
  }

  sheetEnsured = true;
}

/**
 * Splits a bill amount among people, correctly handling tax, tip, and penny allocation rounding.
 */
export function calculateBillSplit(params: {
  total?: number;
  subtotal?: number;
  people: string[];
  tipPercent?: number;
  taxPercent?: number;
}): BillSplitResult {
  const people = params.people.length > 0 ? params.people : ["Me"];
  const n = people.length;

  let totalAmount = 0;
  let subtotal = params.subtotal ?? 0;
  let tipAmount = 0;
  let taxAmount = 0;

  if (params.total !== undefined && params.total > 0) {
    totalAmount = Math.round(params.total * 100) / 100;
    subtotal = totalAmount;
  } else if (params.subtotal !== undefined && params.subtotal > 0) {
    subtotal = params.subtotal;
    const taxRate = (params.taxPercent ?? 0) / 100;
    const tipRate = (params.tipPercent ?? 0) / 100;
    taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    tipAmount = Math.round(subtotal * tipRate * 100) / 100;
    totalAmount = Math.round((subtotal + taxAmount + tipAmount) * 100) / 100;
  }

  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / n);
  const remainderCents = totalCents % n;

  const shares: BillSplitItem[] = people.map((name, index) => {
    // Distribute remainder cents to first k people
    const cents = baseCents + (index < remainderCents ? 1 : 0);
    return {
      name,
      amount: cents / 100,
    };
  });

  return {
    totalAmount,
    subtotal,
    tipAmount,
    taxAmount,
    perPersonShare: baseCents / 100,
    shares,
  };
}

/**
 * Records one or more IOUs in Google Sheets.
 */
export async function recordIOUs(inputs: AddIOUInput[]): Promise<IOURecord[]> {
  if (inputs.length === 0) return [];
  await ensureIOUsSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const createdAt = formatSingaporeTimestamp(new Date());

  const records: IOURecord[] = [];
  const rows: string[][] = [];

  for (const input of inputs) {
    const iouId = createIOUId();
    const payer = (input.payer || "Me").trim();
    const debtor = input.debtor.trim();
    const amount = Math.round(input.amount * 100) / 100;
    const currency = input.currency || "SGD";
    const description = (input.description || "Shared bill").trim();

    records.push({
      rowNumber: 0,
      iouId,
      createdAt,
      payer,
      debtor,
      amount,
      currency,
      description,
      status: "unsettled",
    });

    rows.push([
      iouId,
      createdAt,
      payer,
      debtor,
      amount.toFixed(2),
      currency,
      description,
      "unsettled",
      "",
    ]);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${IOUS_SHEET}!A:I`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  return records;
}

/**
 * Lists IOUs matching given filter criteria.
 */
export async function listIOUs(filter?: {
  status?: "unsettled" | "settled" | "all";
  person?: string;
}): Promise<IOURecord[]> {
  await ensureIOUsSheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${IOUS_SHEET}!A:I`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const targetStatus = filter?.status ?? "unsettled";
  const targetPerson = filter?.person?.toLowerCase().trim();

  const records: IOURecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const iouId = String(row[0] || "").trim();
    const createdAt = String(row[1] || "").trim();
    const payer = String(row[2] || "").trim();
    const debtor = String(row[3] || "").trim();
    const amount = Number(row[4]) || 0;
    const currency = String(row[5] || "SGD").trim();
    const description = String(row[6] || "").trim();
    const status = (String(row[7] || "unsettled").toLowerCase() === "settled"
      ? "settled"
      : "unsettled") as "unsettled" | "settled";
    const settledAt = row[8] ? String(row[8]).trim() : undefined;

    if (targetStatus !== "all" && status !== targetStatus) {
      continue;
    }

    if (targetPerson) {
      const payerMatches = payer.toLowerCase().includes(targetPerson);
      const debtorMatches = debtor.toLowerCase().includes(targetPerson);
      if (!payerMatches && !debtorMatches) {
        continue;
      }
    }

    records.push({
      rowNumber: i + 1,
      iouId,
      createdAt,
      payer,
      debtor,
      amount,
      currency,
      description,
      status,
      settledAt,
    });
  }

  return records;
}

/**
 * Retrieves a single IOU record by ID.
 */
export async function getIOUById(iouId: string): Promise<IOURecord | null> {
  const all = await listIOUs({ status: "all" });
  return all.find((item) => item.iouId === iouId) || null;
}

/**
 * Marks an IOU as settled.
 */
export async function settleIOU(iouId: string): Promise<IOURecord | null> {
  await ensureIOUsSheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const record = await getIOUById(iouId);
  if (!record || record.status === "settled") {
    return record;
  }

  const settledAt = formatSingaporeTimestamp(new Date());

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${IOUS_SHEET}!H${record.rowNumber}:I${record.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["settled", settledAt]],
    },
  });

  return {
    ...record,
    status: "settled",
    settledAt,
  };
}

export interface IOUSummary {
  totalOwedToMe: number;
  totalIOwe: number;
  netBalance: number;
  byPerson: Record<
    string,
    {
      owesMe: number;
      iOwe: number;
      net: number;
    }
  >;
  records: IOURecord[];
}

/**
 * Computes net balances for all unsettled IOUs.
 */
export async function getIOUSummary(): Promise<IOUSummary> {
  const unsettled = await listIOUs({ status: "unsettled" });

  let totalOwedToMe = 0;
  let totalIOwe = 0;
  const byPerson: Record<string, { owesMe: number; iOwe: number; net: number }> = {};

  for (const item of unsettled) {
    const isPayerMe = item.payer.toLowerCase() === "me";
    const otherPerson = isPayerMe ? item.debtor : item.payer;

    if (!byPerson[otherPerson]) {
      byPerson[otherPerson] = { owesMe: 0, iOwe: 0, net: 0 };
    }

    if (isPayerMe) {
      totalOwedToMe += item.amount;
      byPerson[otherPerson].owesMe += item.amount;
      byPerson[otherPerson].net += item.amount;
    } else {
      totalIOwe += item.amount;
      byPerson[otherPerson].iOwe += item.amount;
      byPerson[otherPerson].net -= item.amount;
    }
  }

  return {
    totalOwedToMe: Math.round(totalOwedToMe * 100) / 100,
    totalIOwe: Math.round(totalIOwe * 100) / 100,
    netBalance: Math.round((totalOwedToMe - totalIOwe) * 100) / 100,
    byPerson,
    records: unsettled,
  };
}

/**
 * Formats bill split result into a Telegram-friendly message.
 */
export function formatSplitBillMessage(result: BillSplitResult, description?: string): string {
  const lines: string[] = [
    `🧾 *Bill Split Summary*`,
    description ? `_${description}_` : "",
    "",
    `💰 Total: *$${result.totalAmount.toFixed(2)} SGD*`,
  ];

  if (result.taxAmount > 0 || result.tipAmount > 0) {
    lines.push(`(Subtotal: $${result.subtotal.toFixed(2)} | Tax: $${result.taxAmount.toFixed(2)} | Tip: $${result.tipAmount.toFixed(2)})`);
  }

  lines.push("", `👥 *Breakdown per person:*`);
  for (const share of result.shares) {
    lines.push(`• ${share.name}: *$${share.amount.toFixed(2)}*`);
  }

  return lines.filter(Boolean).join("\n");
}

/**
 * Formats unsettled IOU balances into a Telegram-friendly summary.
 */
export function formatIOUSummaryMessage(summary: IOUSummary): string {
  if (summary.records.length === 0) {
    return "🎉 All settled! Nobody owes you money, and you don't owe anyone.";
  }

  const lines: string[] = [
    `⚖️ *IOU & Debt Balances*`,
    "",
    `🟢 Total owed to you: *$${summary.totalOwedToMe.toFixed(2)} SGD*`,
    `🔴 Total you owe: *$${summary.totalIOwe.toFixed(2)} SGD*`,
    `📊 Net position: *${summary.netBalance >= 0 ? "+" : ""}$${summary.netBalance.toFixed(2)} SGD*`,
    "",
    `👥 *By Person:*`,
  ];

  for (const [person, balance] of Object.entries(summary.byPerson)) {
    if (balance.net > 0) {
      lines.push(`• *${person}* owes you *$${balance.net.toFixed(2)}*`);
    } else if (balance.net < 0) {
      lines.push(`• You owe *${person}* *$${Math.abs(balance.net).toFixed(2)}*`);
    } else {
      lines.push(`• *${person}*: settled (even)`);
    }
  }

  return lines.join("\n");
}
