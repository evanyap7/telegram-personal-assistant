import { getSheetsClient } from "../google";
import type {
  BalanceRow,
  CreditProvider,
  LedgerMeta,
  LedgerStore,
  UsageRow,
} from "./ledger";
import type { Mode, Provider } from "./mode";

const CREDITS_SHEET = "AICredits";
const USAGE_SHEET = "AIUsage";
// AICredits rows: 2 = gemini, 3 = perplexity, 4 = meta (announced mode lives in column E).
const ROW: Record<CreditProvider | "meta", number> = { gemini: 2, perplexity: 3, meta: 4 };

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
      requestBody: {
        values: [
          ["provider", "startBalanceUsd", "setAt", "depletedUntil", "announcedMode"],
          ["gemini", "", "", "", ""],
          ["perplexity", "", "", "", ""],
          ["meta", "", "", "", "credits"],
        ],
      },
    });
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
    range: `${CREDITS_SHEET}!A2:E4`,
  });
  return (res.data.values ?? []) as string[][];
}

export function createSheetsLedgerStore(): LedgerStore {
  return {
    async readBalances() {
      const rows = await readCredits();
      const out: Partial<Record<CreditProvider, BalanceRow>> = {};
      (["gemini", "perplexity"] as const).forEach((provider, i) => {
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
          provider: (r[1] ?? "gemini") as Provider,
          model: r[2] ?? "",
          inputTokens: Number(r[3]) || 0,
          outputTokens: Number(r[4]) || 0,
          costUsd: Number(r[5]) || 0,
          role: r[6] ?? "",
        })
      );
    },

    async readMeta() {
      const rows = await readCredits();
      const depletedUntil: LedgerMeta["depletedUntil"] = {};
      if (rows[0]?.[3]) depletedUntil.gemini = rows[0][3];
      if (rows[1]?.[3]) depletedUntil.perplexity = rows[1][3];
      const announced: Mode = rows[2]?.[4] === "claude" ? "claude" : "credits";
      return { announcedMode: announced, depletedUntil };
    },

    async setBalance(provider, usd, setAtIso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!B${ROW[provider]}:D${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[usd, setAtIso, ""]] },
      });
    },

    async setDepletedUntil(provider, untilIso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!D${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[untilIso]] },
      });
    },

    async writeAnnouncedMode(mode) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!E${ROW.meta}`,
        valueInputOption: "RAW",
        requestBody: { values: [[mode]] },
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
