import { getSheetsClient } from "../google";
import type { AlertState, BalanceRow, CreditProvider, LedgerStore, UsageRow } from "./ledger";
import type { Provider, WarningLevel } from "./mode";

const CREDITS_SHEET = "AICredits";
const USAGE_SHEET = "AIUsage";
// AICredits rows: 2 = anthropic, 3 = perplexity. Columns: provider | startBalanceUsd | setAt | warnedLevel | alertedAt
const ROW: Record<CreditProvider, number> = { anthropic: 2, perplexity: 3 };

const CREDITS_VALUES = [
  ["provider", "startBalanceUsd", "setAt", "warnedLevel", "alertedAt"],
  ["anthropic", "", "", "0", ""],
  ["perplexity", "", "", "0", ""],
  ["", "", "", "", ""],
];

/** The first version of this sheet had a different row 2 (and a "meta" row); row 2 is the tell. */
export function needsLayoutMigration(a2: string | undefined): boolean {
  return a2 !== "anthropic";
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is missing.");
  return id;
}

let ensured = false;

async function ensureSheets(): Promise<void> {
  if (ensured) return;
  const sheets = getSheetsClient();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const titles = (meta.data.sheets || []).map((s) => s.properties?.title);

  if (!titles.includes(CREDITS_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: CREDITS_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${CREDITS_SHEET}!A1:E4`,
      valueInputOption: "RAW",
      requestBody: { values: CREDITS_VALUES },
    });
  } else {
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${CREDITS_SHEET}!A2:A2`,
    });
    if (needsLayoutMigration(head.data.values?.[0]?.[0])) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${CREDITS_SHEET}!A1:E4`,
        valueInputOption: "RAW",
        requestBody: { values: CREDITS_VALUES },
      });
    }
  }

  if (!titles.includes(USAGE_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: USAGE_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${USAGE_SHEET}!A1:G1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["timestamp", "provider", "model", "inputTokens", "outputTokens", "costUsd", "role"]],
      },
    });
  }
  ensured = true;
}

async function readCredits(): Promise<string[][]> {
  await ensureSheets();
  const res = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${CREDITS_SHEET}!A2:E3`,
  });
  return (res.data.values ?? []) as string[][];
}

function toLevel(raw: string | undefined): WarningLevel {
  const n = parseInt(raw ?? "", 10);
  return n === 5 ? 5 : n === 10 ? 10 : 0;
}

export function createSheetsLedgerStore(): LedgerStore {
  return {
    async readBalances() {
      const rows = await readCredits();
      const out: Partial<Record<CreditProvider, BalanceRow>> = {};
      (["anthropic", "perplexity"] as const).forEach((provider, i) => {
        const r = rows[i] ?? [];
        const balance = parseFloat(r[1] ?? "");
        if (Number.isFinite(balance) && r[2]) out[provider] = { startBalanceUsd: balance, setAt: r[2] };
      });
      return out;
    },

    async readUsage() {
      await ensureSheets();
      const res = await getSheetsClient().spreadsheets.values.get({
        spreadsheetId: spreadsheetId(),
        range: `${USAGE_SHEET}!A2:G`,
      });
      return ((res.data.values ?? []) as string[][]).map(
        (r): UsageRow => ({
          timestamp: r[0] ?? "",
          provider: (r[1] ?? "anthropic") as Provider,
          model: r[2] ?? "",
          inputTokens: Number(r[3]) || 0,
          outputTokens: Number(r[4]) || 0,
          costUsd: Number(r[5]) || 0,
          role: r[6] ?? "",
        })
      );
    },

    async readAlertState() {
      const rows = await readCredits();
      const state = (i: number): AlertState => ({
        warnedLevel: toLevel(rows[i]?.[3]),
        alertedAt: rows[i]?.[4] || undefined,
      });
      return { anthropic: state(0), perplexity: state(1) };
    },

    async setBalance(provider, usd, setAtIso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!B${ROW[provider]}:E${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[usd, setAtIso, "0", ""]] },
      });
    },

    async setWarnedLevel(provider, level) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!D${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[String(level)]] },
      });
    },

    async setAlertedAt(provider, iso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!E${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[iso]] },
      });
    },

    async appendUsage(row) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.append({
        spreadsheetId: spreadsheetId(),
        range: `${USAGE_SHEET}!A:G`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[row.timestamp, row.provider, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.role]],
        },
      });
    },
  };
}
