import { getSheetsClient } from "./google";
import { formatSingaporeTimestamp } from "./finance";
import { deleteSheetRows } from "./sheet-rows";

const CHAT_HISTORY_SHEET = "ChatHistory";

export type ChatHistoryEntry = {
  messageId?: number | string;
  userId: number;
  role: "user" | "assistant";
  text: string;
  photoFileId?: string;
  actionType?: string;
  timestamp?: string;
};

export type FormattedChatTurn = {
  role: "user" | "assistant";
  text: string;
  photoFileId?: string;
  actionType?: string;
  timestamp: string;
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  return spreadsheetId;
}

let sheetEnsured = false;

export async function ensureChatHistorySheetExists(): Promise<void> {
  if (sheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const existingSheet = meta.data.sheets?.some(
      (s) => s.properties?.title === CHAT_HISTORY_SHEET
    );

    if (!existingSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: CHAT_HISTORY_SHEET,
                },
              },
            },
          ],
        },
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${CHAT_HISTORY_SHEET}!A1:G1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              "Message ID",
              "Timestamp",
              "User ID",
              "Role",
              "Text",
              "Photo File ID",
              "Action Type",
            ],
          ],
        },
      });
    }

    sheetEnsured = true;
  } catch (error) {
    console.error("Failed to ensure ChatHistory sheet exists:", error);
  }
}

// In-memory sliding window cache across warm invocations
const MAX_CACHED_TURNS = 30;
const memoryChatCache = new Map<number, FormattedChatTurn[]>();

export function clearChatHistoryMemoryCache(userId?: number): void {
  if (userId !== undefined) {
    memoryChatCache.delete(userId);
  } else {
    memoryChatCache.clear();
  }
}

export async function logChatMessage(entry: ChatHistoryEntry): Promise<void> {
  const timestamp = entry.timestamp || formatSingaporeTimestamp(new Date());

  // Update warm memory cache immediately
  const existing = memoryChatCache.get(entry.userId) || [];
  existing.push({
    timestamp,
    role: entry.role,
    text: entry.text,
    photoFileId: entry.photoFileId,
    actionType: entry.actionType,
  });
  if (existing.length > MAX_CACHED_TURNS) {
    existing.splice(0, existing.length - MAX_CACHED_TURNS);
  }
  memoryChatCache.set(entry.userId, existing);

  try {
    await ensureChatHistorySheetExists();

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${CHAT_HISTORY_SHEET}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            String(entry.messageId ?? ""),
            timestamp,
            String(entry.userId),
            entry.role,
            entry.text,
            entry.photoFileId ?? "",
            entry.actionType ?? "",
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Failed to log chat message to Google Sheets:", error);
  }
}

export async function getRecentChatHistory(
  userId: number,
  limit = 10
): Promise<FormattedChatTurn[]> {
  // Check warm cache first
  const cached = memoryChatCache.get(userId);
  if (cached && cached.length >= Math.min(limit, 4)) {
    return cached.slice(-limit);
  }

  try {
    await ensureChatHistorySheetExists();

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${CHAT_HISTORY_SHEET}!A2:G`,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      return [];
    }

    const userTurns: FormattedChatTurn[] = [];

    for (const row of rows) {
      const rowUserId = Number(row[2]);
      if (rowUserId === userId) {
        userTurns.push({
          timestamp: row[1] ? String(row[1]).trim() : "",
          role: row[3] === "user" ? "user" : "assistant",
          text: row[4] ? String(row[4]).trim() : "",
          photoFileId: row[5] ? String(row[5]).trim() : undefined,
          actionType: row[6] ? String(row[6]).trim() : undefined,
        });
      }
    }

    // Populate warm memory cache
    memoryChatCache.set(userId, userTurns.slice(-MAX_CACHED_TURNS));

    return userTurns.slice(-limit);
  } catch (error) {
    console.error("Failed to retrieve chat history from Google Sheets:", error);
    return [];
  }
}

export async function pruneOldChatHistory(
  daysToKeep = 30
): Promise<{ prunedCount: number; remainingCount: number }> {
  try {
    await ensureChatHistorySheetExists();

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${CHAT_HISTORY_SHEET}!A2:G`,
    });

    const rows = res.data.values ?? [];
    if (rows.length === 0) {
      return { prunedCount: 0, remainingCount: 0 };
    }

    const cutoffMs = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const pruneRowNumbers: number[] = [];

    rows.forEach((row, index) => {
      const timeMs = new Date(row[1]).getTime();
      if (!Number.isNaN(timeMs) && timeMs < cutoffMs) {
        pruneRowNumbers.push(index + 2);
      }
    });

    await deleteSheetRows({
      spreadsheetId,
      sheetTitle: CHAT_HISTORY_SHEET,
      rowNumbers: pruneRowNumbers,
    });

    return {
      prunedCount: pruneRowNumbers.length,
      remainingCount: rows.length - pruneRowNumbers.length,
    };
  } catch (error) {
    console.error("Failed to prune chat history in Google Sheets:", error);
    return { prunedCount: 0, remainingCount: 0 };
  }
}
