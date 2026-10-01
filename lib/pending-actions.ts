import { getSheetsClient } from "./google";
import { deleteSheetRows } from "./sheet-rows";

const SHEET_NAME = "PendingActions";
const EXPIRY_MS = 5 * 60 * 1000;

export type CalendarAddPayload =
  | {
      calendarName: "personal" | "work";
      allDay: false;
      title: string;
      start: string;
      end: string;
      location?: string;
      reminderMinutes?: number;
    }
  | {
      calendarName: "personal" | "work";
      allDay: true;
      title: string;
      date: string;
      location?: string;
      reminderMinutes?: number;
    };

export type FinanceAddPayload = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  description: string;
  transactionDate: string;
};

export type FinanceSelectionPayload = {
  transactionIds: string[];
};

export type CalendarSelectionItem = {
  eventId: string;
  title: string;
  start: string;
  end: string;
};

export type CalendarSelectionPayload = {
  calendarName: "personal" | "work";
  events: CalendarSelectionItem[];
};

export type FinanceDeletePayload = {
  transactionId: string;
};

export type CalendarDeletePayload = {
  calendarName: "personal" | "work";
  eventId: string;
};

export type CalendarBatchEventItem =
  | {
      allDay: false;
      title: string;
      start: string;
      end: string;
      location?: string;
      reminderMinutes?: number;
    }
  | {
      allDay: true;
      title: string;
      date: string;
      location?: string;
      reminderMinutes?: number;
    };

export type CalendarBatchAddPayload = {
  calendarName: "personal" | "work";
  events: CalendarBatchEventItem[];
};

export type EmailDraftPayload = {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
};

export type TodoDeletePayload = {
  taskId: string;
  task: string;
};

export type TodoSelectionItem = {
  taskId: string;
  task: string;
};

export type CalendarReschedulePayload = {
  calendarName: "personal" | "work";
  eventId: string;
  title: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
};

export type UndoPayload = {
  type:
    | "calendar_event_created"
    | "calendar_batch_created"
    | "finance_transaction_created"
    | "finance_batch_created"
    | "todo_completed"
    | "todo_created"
    | "todo_batch_created"
    | "workout_logged";
  description: string;
  data: Record<string, string>;
};

export type TodoSelectionPayload = {
  todos: TodoSelectionItem[];
};

export type PendingImagePayload = {
  fileId: string;
  fileIds?: string[];
  mediaType?: string;
  sentAt: string;
};

export type FinanceBatchItemPayload = {
  type: "income" | "expense";
  amount: number;
  currency: string;
  category: string;
  description: string;
  transactionDate: string;
};

export type FinanceBatchAddPayload = {
  transactions: FinanceBatchItemPayload[];
};

type PendingActionType =
  | "calendar_add"
  | "calendar_batch_add"
  | "finance_add"
  | "finance_batch_add"
  | "pending_image"
  | "finance_select"
  | "calendar_select"
  | "finance_delete"
  | "calendar_delete"
  | "email_draft"
  | "todo_select"
  | "todo_delete"
  | "calendar_reschedule"
  | "undo";

type PendingStatus = "pending" | "selected" | "confirmed" | "cancelled";

type PendingRow = {
  token: string;
  userId: number;
  actionType: PendingActionType;
  payloadJson: string;
  expiresAt: string;
  status: string;
  rowNumber: number;
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  return spreadsheetId;
}

function createToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function isExpired(expiresAt: string): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();

  return Number.isNaN(expiresAtMs) || expiresAtMs < Date.now();
}

async function savePendingAction(input: {
  userId: number;
  actionType: PendingActionType;
  payload: unknown;
  status?: PendingStatus;
  expiryMs?: number;
}): Promise<string> {
  const token = createToken();
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          token,
          String(input.userId),
          input.actionType,
          JSON.stringify(input.payload),
          new Date(Date.now() + (input.expiryMs ?? EXPIRY_MS)).toISOString(),
          input.status ?? "pending",
        ],
      ],
    },
  });

  return token;
}

async function findPendingRow(token: string): Promise<PendingRow | null> {
  const sheets = getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  const rowIndex = rows.findIndex((row) => row[0] === token);

  if (rowIndex === -1) {
    return null;
  }

  const row = rows[rowIndex];

  return {
    token: row[0] ?? "",
    userId: Number(row[1]),
    actionType: (row[2] ?? "") as PendingActionType,
    payloadJson: row[3] ?? "",
    expiresAt: row[4] ?? "",
    status: row[5] ?? "",
    rowNumber: rowIndex + 2,
  };
}

async function setPendingStatus(
  rowNumber: number,
  status: PendingStatus
): Promise<void> {
  const sheets = getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!F${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[status]],
    },
  });
}

function parsePayload<T>(payloadJson: string): T {
  try {
    return JSON.parse(payloadJson) as T;
  } catch {
    throw new Error("Stored confirmation data is invalid.");
  }
}

async function takePendingAction<T>(input: {
  token: string;
  userId: number;
  actionType: PendingActionType;
  allowedStatuses?: PendingStatus[];
  nextStatus?: PendingStatus;
}): Promise<{ payload: T; rowNumber: number } | null> {
  const row = await findPendingRow(input.token);

  if (
    !row ||
    row.userId !== input.userId ||
    row.actionType !== input.actionType ||
    isExpired(row.expiresAt) ||
    !(input.allowedStatuses ?? ["pending"]).includes(
      row.status as PendingStatus
    )
  ) {
    return null;
  }

  const payload = parsePayload<T>(row.payloadJson);

  if (input.nextStatus) {
    await setPendingStatus(row.rowNumber, input.nextStatus);
  }

  return {
    payload,
    rowNumber: row.rowNumber,
  };
}

async function cancelPendingAction(input: {
  token: string;
  userId: number;
  actionType: PendingActionType;
  allowedStatuses?: PendingStatus[];
}): Promise<boolean> {
  const row = await findPendingRow(input.token);

  if (
    !row ||
    row.userId !== input.userId ||
    row.actionType !== input.actionType ||
    isExpired(row.expiresAt) ||
    !(input.allowedStatuses ?? ["pending"]).includes(
      row.status as PendingStatus
    )
  ) {
    return false;
  }

  await setPendingStatus(row.rowNumber, "cancelled");

  return true;
}

export async function savePendingCalendarAction(input: {
  userId: number;
  payload: CalendarAddPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_add",
    payload: input.payload,
  });
}

export async function takePendingCalendarAction(
  token: string,
  userId: number
): Promise<{ payload: CalendarAddPayload } | null> {
  const result = await takePendingAction<CalendarAddPayload>({
    token,
    userId,
    actionType: "calendar_add",
    nextStatus: "confirmed",
  });

  return result ? { payload: result.payload } : null;
}

export async function cancelPendingCalendarAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "calendar_add",
  });
}

export async function savePendingCalendarBatchAction(input: {
  userId: number;
  payload: CalendarBatchAddPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_batch_add",
    payload: input.payload,
  });
}

export async function takePendingCalendarBatchAction(
  token: string,
  userId: number
): Promise<CalendarBatchAddPayload | null> {
  const result = await takePendingAction<CalendarBatchAddPayload>({
    token,
    userId,
    actionType: "calendar_batch_add",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingCalendarBatchAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "calendar_batch_add",
  });
}

export async function savePendingFinanceAddAction(input: {
  userId: number;
  payload: FinanceAddPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "finance_add",
    payload: input.payload,
  });
}

export async function takePendingFinanceAddAction(
  token: string,
  userId: number
): Promise<FinanceAddPayload | null> {
  const result = await takePendingAction<FinanceAddPayload>({
    token,
    userId,
    actionType: "finance_add",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingFinanceAddAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "finance_add",
  });
}

export async function savePendingFinanceBatchAction(input: {
  userId: number;
  payload: FinanceBatchAddPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "finance_batch_add",
    payload: input.payload,
  });
}

export async function takePendingFinanceBatchAction(
  token: string,
  userId: number
): Promise<FinanceBatchAddPayload | null> {
  const result = await takePendingAction<FinanceBatchAddPayload>({
    token,
    userId,
    actionType: "finance_batch_add",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingFinanceBatchAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "finance_batch_add",
  });
}

export async function savePendingImageAction(input: {
  userId: number;
  payload: PendingImagePayload;
}): Promise<string> {
  const newFileIds = input.payload.fileIds?.length
    ? input.payload.fileIds
    : [input.payload.fileId];

  const latest = await getLatestPendingImage(input.userId);
  if (latest) {
    const existingFileIds = latest.payload.fileIds?.length
      ? latest.payload.fileIds
      : [latest.payload.fileId];

    const combinedFileIds = Array.from(
      new Set([...existingFileIds, ...newFileIds])
    );

    const updatedPayload: PendingImagePayload = {
      fileId: combinedFileIds[0],
      fileIds: combinedFileIds,
      mediaType: input.payload.mediaType ?? latest.payload.mediaType,
      sentAt: new Date().toISOString(),
    };

    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${SHEET_NAME}!D${latest.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[JSON.stringify(updatedPayload)]],
      },
    });

    return latest.token;
  }

  return savePendingAction({
    userId: input.userId,
    actionType: "pending_image",
    payload: {
      ...input.payload,
      fileIds: newFileIds,
    },
  });
}

export async function getLatestPendingImage(
  userId: number
): Promise<{ token: string; payload: PendingImagePayload; rowNumber: number } | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const rowUserId = Number(row[1]);
    const actionType = row[2];
    const payloadJson = row[3] ?? "{}";
    const expiresAt = row[4] ?? "";
    const status = row[5] ?? "";

    if (
      rowUserId === userId &&
      actionType === "pending_image" &&
      status === "pending" &&
      !isExpired(expiresAt)
    ) {
      try {
        const payload = JSON.parse(payloadJson) as PendingImagePayload;
        return { token: row[0], payload, rowNumber: i + 2 };
      } catch {}
    }
  }
  return null;
}

export async function consumePendingImage(token: string): Promise<boolean> {
  const row = await findPendingRow(token);
  if (!row) return false;
  await setPendingStatus(row.rowNumber, "confirmed");
  return true;
}

export async function savePendingFinanceSelection(input: {
  userId: number;
  transactionIds: string[];
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "finance_select",
    payload: {
      transactionIds: input.transactionIds,
    } satisfies FinanceSelectionPayload,
  });
}

export async function takePendingFinanceSelection(
  token: string,
  userId: number
): Promise<FinanceSelectionPayload | null> {
  const result = await takePendingAction<FinanceSelectionPayload>({
    token,
    userId,
    actionType: "finance_select",
    nextStatus: "selected",
  });

  return result?.payload ?? null;
}

export async function savePendingCalendarSelection(input: {
  userId: number;
  calendarName: "personal" | "work";
  events: CalendarSelectionItem[];
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_select",
    payload: {
      calendarName: input.calendarName,
      events: input.events,
    } satisfies CalendarSelectionPayload,
  });
}

export async function takePendingCalendarSelection(
  token: string,
  userId: number
): Promise<CalendarSelectionPayload | null> {
  const result = await takePendingAction<CalendarSelectionPayload>({
    token,
    userId,
    actionType: "calendar_select",
    nextStatus: "selected",
  });

  return result?.payload ?? null;
}

export async function savePendingFinanceDeleteAction(input: {
  userId: number;
  payload: FinanceDeletePayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "finance_delete",
    payload: input.payload,
  });
}

export async function takePendingFinanceDeleteAction(
  token: string,
  userId: number
): Promise<FinanceDeletePayload | null> {
  const result = await takePendingAction<FinanceDeletePayload>({
    token,
    userId,
    actionType: "finance_delete",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingFinanceDeleteAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "finance_delete",
  });
}

export async function savePendingCalendarDeleteAction(input: {
  userId: number;
  payload: CalendarDeletePayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_delete",
    payload: input.payload,
  });
}

export async function takePendingCalendarDeleteAction(
  token: string,
  userId: number
): Promise<CalendarDeletePayload | null> {
  const result = await takePendingAction<CalendarDeletePayload>({
    token,
    userId,
    actionType: "calendar_delete",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingCalendarDeleteAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "calendar_delete",
  });
}

export async function savePendingEmailDraftAction(input: {
  userId: number;
  payload: EmailDraftPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "email_draft",
    payload: input.payload,
  });
}

export async function takePendingEmailDraftAction(
  token: string,
  userId: number
): Promise<EmailDraftPayload | null> {
  const result = await takePendingAction<EmailDraftPayload>({
    token,
    userId,
    actionType: "email_draft",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingEmailDraftAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "email_draft",
  });
}

export async function savePendingTodoDeleteAction(input: {
  userId: number;
  payload: TodoDeletePayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "todo_delete",
    payload: input.payload,
  });
}

export async function takePendingTodoDeleteAction(
  token: string,
  userId: number
): Promise<TodoDeletePayload | null> {
  const result = await takePendingAction<TodoDeletePayload>({
    token,
    userId,
    actionType: "todo_delete",
    nextStatus: "confirmed",
  });

  return result?.payload ?? null;
}

export async function cancelPendingTodoDeleteAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "todo_delete",
  });
}

export async function savePendingTodoSelection(input: {
  userId: number;
  payload: TodoSelectionPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "todo_select",
    payload: input.payload,
  });
}

export async function takePendingTodoSelection(
  token: string,
  userId: number
): Promise<TodoSelectionPayload | null> {
  const result = await takePendingAction<TodoSelectionPayload>({
    token,
    userId,
    actionType: "todo_select",
    allowedStatuses: ["pending"],
    nextStatus: "selected",
  });

  return result?.payload ?? null;
}

export type UserCalendarContext = {
  activePending?: {
    token: string;
    rowNumber: number;
    payload: CalendarAddPayload;
  };
  recentConfirmed?: {
    calendarName: "personal" | "work";
    title: string;
    allDay?: boolean;
    start?: string;
    end?: string;
    date?: string;
    location?: string;
    eventId?: string;
  };
};

export async function getLatestUserCalendarContext(
  userId: number
): Promise<UserCalendarContext> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  let activePending: UserCalendarContext["activePending"] | undefined;
  let recentConfirmed: UserCalendarContext["recentConfirmed"] | undefined;

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const rowUserId = Number(row[1]);
    const actionType = row[2] as PendingActionType;
    const payloadJson = row[3] ?? "{}";
    const expiresAt = row[4] ?? "";
    const status = row[5] ?? "";

    if (rowUserId !== userId) continue;

    if (
      !activePending &&
      actionType === "calendar_add" &&
      status === "pending" &&
      !isExpired(expiresAt)
    ) {
      try {
        activePending = {
          token: row[0],
          rowNumber: i + 2,
          payload: JSON.parse(payloadJson),
        };
      } catch {}
    }

    if (
      !recentConfirmed &&
      actionType === "calendar_add" &&
      status === "confirmed"
    ) {
      try {
        const parsed = JSON.parse(payloadJson);
        recentConfirmed = {
          calendarName: parsed.calendarName,
          title: parsed.title,
          allDay: parsed.allDay,
          start: parsed.start,
          end: parsed.end,
          date: parsed.date,
          location: parsed.location,
          eventId: parsed.eventId,
        };
      } catch {}
    }

    if (activePending && recentConfirmed) break;
  }

  return { activePending, recentConfirmed };
}

export async function recordConfirmedCalendarEvent(input: {
  token: string;
  eventId: string;
}): Promise<void> {
  const row = await findPendingRow(input.token);
  if (!row) return;

  const sheets = getSheetsClient();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson);
  } catch {}

  payload.eventId = input.eventId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!D${row.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[JSON.stringify(payload)]],
    },
  });
}

export async function cancelActivePendingCalendarAction(
  userId: number
): Promise<boolean> {
  const context = await getLatestUserCalendarContext(userId);
  if (!context.activePending) return false;

  await setPendingStatus(context.activePending.rowNumber, "cancelled");
  return true;
}

export async function pruneExpiredPendingActions(
  hoursToKeep = 24
): Promise<{ prunedCount: number; remainingCount: number }> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];
  if (rows.length === 0) {
    return { prunedCount: 0, remainingCount: 0 };
  }

  const nowMs = Date.now();
  const cutoffMs = nowMs - hoursToKeep * 60 * 60 * 1000;
  const pruneRowNumbers: number[] = [];

  rows.forEach((row, index) => {
    const expiresAtMs = new Date(row[4]).getTime();
    const isLivePending = row[5] === "pending" && expiresAtMs > nowMs;
    if (!isLivePending && !Number.isNaN(expiresAtMs) && expiresAtMs < cutoffMs) {
      pruneRowNumbers.push(index + 2);
    }
  });

  await deleteSheetRows({
    spreadsheetId,
    sheetTitle: SHEET_NAME,
    rowNumbers: pruneRowNumbers,
  });

  return {
    prunedCount: pruneRowNumbers.length,
    remainingCount: rows.length - pruneRowNumbers.length,
  };
}

export async function savePendingCalendarRescheduleAction(input: {
  userId: number;
  payload: CalendarReschedulePayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "calendar_reschedule",
    payload: input.payload,
  });
}

export async function takePendingCalendarRescheduleAction(
  token: string,
  userId: number
): Promise<CalendarReschedulePayload | null> {
  const result = await takePendingAction<CalendarReschedulePayload>({
    token,
    userId,
    actionType: "calendar_reschedule",
    nextStatus: "confirmed",
  });
  return result?.payload ?? null;
}

export async function cancelPendingCalendarRescheduleAction(
  token: string,
  userId: number
): Promise<boolean> {
  return cancelPendingAction({
    token,
    userId,
    actionType: "calendar_reschedule",
  });
}

const UNDO_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Undo tokens are persisted in the PendingActions sheet (not process memory)
 * so an Undo tap works even when it lands on a different serverless instance.
 */
export async function saveUndoAction(input: {
  userId: number;
  payload: UndoPayload;
}): Promise<string> {
  return savePendingAction({
    userId: input.userId,
    actionType: "undo",
    payload: input.payload,
    expiryMs: UNDO_EXPIRY_MS,
  });
}

export async function takeUndoAction(
  token: string,
  userId: number
): Promise<UndoPayload | null> {
  const result = await takePendingAction<UndoPayload>({
    token,
    userId,
    actionType: "undo",
    nextStatus: "confirmed",
  });
  return result?.payload ?? null;
}

export async function takeLatestUndoAction(
  userId: number
): Promise<{ token: string; payload: UndoPayload } | null> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:F`,
  });

  const rows = response.data.values ?? [];

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const token = row[0] ?? "";
    const rowUserId = Number(row[1]);
    const actionType = row[2] as PendingActionType;
    const payloadJson = row[3] ?? "{}";
    const expiresAt = row[4] ?? "";
    const status = row[5] ?? "";

    if (
      rowUserId === userId &&
      actionType === "undo" &&
      status === "pending" &&
      !isExpired(expiresAt)
    ) {
      await setPendingStatus(i + 2, "confirmed");
      try {
        return {
          token,
          payload: parsePayload<UndoPayload>(payloadJson),
        };
      } catch {
        return null;
      }
    }
  }

  return null;
}
