import { getSheetsClient } from "./google";

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

export async function logChatMessage(entry: ChatHistoryEntry): Promise<void> {
  try {
    await ensureChatHistorySheetExists();

    const sheets = getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    const timestamp = entry.timestamp || formatSingaporeTimestamp(new Date());

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

    return userTurns.slice(-limit);
  } catch (error) {
    console.error("Failed to retrieve chat history from Google Sheets:", error);
    return [];
  }
}
