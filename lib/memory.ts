import { getSheetsClient } from "./google";
import { formatSingaporeTimestamp } from "./finance";

const MEMORY_SHEET = "Memory";

export type MemoryCategory =
  | "note"
  | "contact"
  | "fact"
  | "preference"
  | "credential";

export interface MemoryRecord {
  rowNumber: number;
  memoryId: string;
  createdAt: string;
  updatedAt: string;
  category: MemoryCategory;
  key: string;
  value: string;
  tags: string[];
}

export interface SaveMemoryInput {
  category?: MemoryCategory;
  key: string;
  value: string;
  tags?: string[];
}

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }
  return spreadsheetId;
}

function createMemoryId(): string {
  return `mem_${crypto.randomUUID().slice(0, 8)}`;
}

let sheetEnsured = false;

export async function ensureMemorySheetExists(): Promise<void> {
  if (sheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const sheetNames = (meta.data.sheets || [])
    .map((s) => s.properties?.title)
    .filter(Boolean);

  if (!sheetNames.includes(MEMORY_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: MEMORY_SHEET,
              },
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${MEMORY_SHEET}!A1:G1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "memory_id",
            "created_at",
            "updated_at",
            "category",
            "key",
            "value",
            "tags",
          ],
        ],
      },
    });
  }

  sheetEnsured = true;
}

/**
 * Lists all memory items from Google Sheets.
 */
export async function listAllMemories(): Promise<MemoryRecord[]> {
  await ensureMemorySheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${MEMORY_SHEET}!A:G`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const records: MemoryRecord[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const memoryId = String(row[0] || "").trim();
    const createdAt = String(row[1] || "").trim();
    const updatedAt = String(row[2] || "").trim();
    const category = (String(row[3] || "note").trim().toLowerCase() as MemoryCategory) || "note";
    const key = String(row[4] || "").trim();
    const value = String(row[5] || "").trim();
    const tags = String(row[6] || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    records.push({
      rowNumber: i + 1,
      memoryId,
      createdAt,
      updatedAt,
      category,
      key,
      value,
      tags,
    });
  }

  return records;
}

/**
 * Saves or updates a memory entry in Google Sheets.
 */
export async function saveMemory(input: SaveMemoryInput): Promise<MemoryRecord> {
  await ensureMemorySheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const nowStr = formatSingaporeTimestamp(new Date());

  const category = input.category || "note";
  const cleanKey = input.key.trim();
  const cleanVal = input.value.trim();
  const tags = (input.tags || []).map((t) => t.trim()).filter(Boolean);
  const tagsStr = tags.join(", ");

  const existing = await listAllMemories();
  const match = existing.find(
    (m) =>
      m.key.toLowerCase() === cleanKey.toLowerCase() &&
      (!input.category || m.category === input.category)
  );

  if (match) {
    // Update existing row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${MEMORY_SHEET}!C${match.rowNumber}:G${match.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[nowStr, category, cleanKey, cleanVal, tagsStr]],
      },
    });

    return {
      ...match,
      updatedAt: nowStr,
      category,
      key: cleanKey,
      value: cleanVal,
      tags,
    };
  }

  // Create new row
  const memoryId = createMemoryId();
  const newRecord: MemoryRecord = {
    rowNumber: 0,
    memoryId,
    createdAt: nowStr,
    updatedAt: nowStr,
    category,
    key: cleanKey,
    value: cleanVal,
    tags,
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${MEMORY_SHEET}!A:G`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[memoryId, nowStr, nowStr, category, cleanKey, cleanVal, tagsStr]],
    },
  });

  return newRecord;
}

/**
 * Gets a memory record by exact key match.
 */
export async function getMemoryByKey(
  key: string,
  category?: MemoryCategory
): Promise<MemoryRecord | null> {
  const all = await listAllMemories();
  const target = key.toLowerCase().trim();
  return (
    all.find(
      (m) =>
        m.key.toLowerCase() === target &&
        (!category || m.category === category)
    ) || null
  );
}

/**
 * Deletes a memory record by key or memoryId.
 */
export async function deleteMemory(keyOrId: string): Promise<boolean> {
  await ensureMemorySheetExists();
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const all = await listAllMemories();
  const target = keyOrId.toLowerCase().trim();
  const match = all.find(
    (m) => m.memoryId.toLowerCase() === target || m.key.toLowerCase() === target
  );

  if (!match) return false;

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${MEMORY_SHEET}!A${match.rowNumber}:G${match.rowNumber}`,
  });

  return true;
}
