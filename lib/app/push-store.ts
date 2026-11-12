import { getSheetsClient } from "../google";
import type { StoredSubscription } from "./push";

export type { StoredSubscription };

// Google Sheets store for the owner's push subscriptions. Columns: endpoint, p256dh, auth,
// createdAt (ISO-8601). The tab is created on first use, like the other stores.
const SHEET = "PushSubscriptions";

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is missing.");
  return id;
}

let ensured = false;

async function ensureSheet(): Promise<void> {
  if (ensured) return;
  const sheets = getSheetsClient();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === SHEET);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET, gridProperties: { frozenRowCount: 1 } } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${SHEET}!A1:D1`,
      valueInputOption: "RAW",
      requestBody: { values: [["endpoint", "p256dh", "auth", "createdAt"]] },
    });
  }
  ensured = true;
}

async function readRows(): Promise<string[][]> {
  await ensureSheet();
  const res = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET}!A2:D`,
  });
  return (res.data.values ?? []) as string[][];
}

export async function listSubscriptions(): Promise<StoredSubscription[]> {
  const rows = await readRows();
  const out: StoredSubscription[] = [];
  for (const [endpoint, p256dh, auth] of rows) {
    if (endpoint && p256dh && auth) out.push({ endpoint, keys: { p256dh, auth } });
  }
  return out;
}

/** Adds the subscription, or refreshes its keys when the endpoint is already stored. */
export async function saveSubscription(sub: StoredSubscription): Promise<void> {
  const rows = await readRows();
  const sheets = getSheetsClient();
  const values = [[sub.endpoint, sub.keys.p256dh, sub.keys.auth, new Date().toISOString()]];
  const idx = rows.findIndex((r) => r[0] === sub.endpoint);
  if (idx >= 0) {
    const row = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${SHEET}!A${row}:D${row}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
    return;
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${SHEET}!A:D`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

/** Clears the matching rows; list skips blank rows, so no row deletion is needed. */
export async function removeSubscription(endpoint: string): Promise<void> {
  const rows = await readRows();
  const sheets = getSheetsClient();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] !== endpoint) continue;
    const row = i + 2;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: spreadsheetId(),
      range: `${SHEET}!A${row}:D${row}`,
    });
  }
}
