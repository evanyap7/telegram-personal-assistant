import { getSheetsClient } from "./google";
import { formatSingaporeTimestamp } from "./finance";
import { sendTelegramMessage } from "./telegram";

const TODOS_SHEET = "Todos";

export type TodoItem = {
  rowNumber: number;
  taskId: string;
  createdAt: string;
  task: string;
  dueDate: string;
  priority: "low" | "medium" | "high";
  status: "active" | "completed" | "deleted";
  completedAt: string;
  remindIntervalMinutes?: number;
  lastRemindedAt?: string;
  chatId?: number;
};

export type AddTodoInput = {
  task: string;
  dueDate?: string;
  priority?: "low" | "medium" | "high";
  remindIntervalMinutes?: number;
  chatId?: number;
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is missing.");
  }

  return spreadsheetId;
}

function createTaskId(): string {
  return `todo_${crypto.randomUUID().slice(0, 8)}`;
}

export function getSingaporeTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

let sheetEnsured = false;

async function ensureTodosSheetExists(): Promise<void> {
  if (sheetEnsured) return;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const existingSheet = meta.data.sheets?.some(
    (s) => s.properties?.title === TODOS_SHEET
  );

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: TODOS_SHEET,
              },
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${TODOS_SHEET}!A1:J1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "Task ID",
            "Created At",
            "Task",
            "Due Date",
            "Priority",
            "Status",
            "Completed At",
            "Remind Interval Mins",
            "Last Reminded At",
            "Chat ID",
          ],
        ],
      },
    });
  } else {
    // Backfill header columns H-J if upgrading existing sheet
    try {
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${TODOS_SHEET}!A1:J1`,
      });
      const headers = headerRes.data.values?.[0] ?? [];
      if (headers.length < 8 || !headers[7]) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${TODOS_SHEET}!H1:J1`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [["Remind Interval Mins", "Last Reminded At", "Chat ID"]],
          },
        });
      }
    } catch (err) {
      console.warn("Could not check/update todos sheet headers:", err);
    }
  }

  sheetEnsured = true;
}

function normaliseCell(value: string | undefined): string {
  return value?.trim() ?? "";
}

function rowToTodo(row: string[], rowNumber: number): TodoItem {
  const priorityRaw = normaliseCell(row[4]).toLowerCase();
  const priority: "low" | "medium" | "high" =
    priorityRaw === "high" || priorityRaw === "low" ? priorityRaw : "medium";

  const statusRaw = normaliseCell(row[5]).toLowerCase();
  const status: "active" | "completed" | "deleted" =
    statusRaw === "completed" || statusRaw === "deleted"
      ? statusRaw
      : "active";

  const remindIntervalRaw = Number(normaliseCell(row[7]));
  const remindIntervalMinutes =
    !Number.isNaN(remindIntervalRaw) && remindIntervalRaw > 0
      ? remindIntervalRaw
      : undefined;

  const lastRemindedAt = normaliseCell(row[8]) || undefined;
  const chatIdRaw = Number(normaliseCell(row[9]));
  const chatId = !Number.isNaN(chatIdRaw) && chatIdRaw > 0 ? chatIdRaw : undefined;

  return {
    rowNumber,
    taskId: normaliseCell(row[0]),
    createdAt: normaliseCell(row[1]),
    task: normaliseCell(row[2]),
    dueDate: normaliseCell(row[3]),
    priority,
    status,
    completedAt: normaliseCell(row[6]),
    remindIntervalMinutes,
    lastRemindedAt,
    chatId,
  };
}

export async function addTodo(input: AddTodoInput): Promise<TodoItem> {
  await ensureTodosSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const taskId = createTaskId();
  const createdAt = formatSingaporeTimestamp();
  const dueDate = input.dueDate?.trim() ?? "";
  const priority = input.priority ?? "medium";
  const status = "active";
  const completedAt = "";

  const remindInterval =
    input.remindIntervalMinutes && input.remindIntervalMinutes > 0
      ? String(input.remindIntervalMinutes)
      : "";
  // Initialize lastRemindedAt to now so the first recurring reminder fires after the interval
  const lastRemindedAt = remindInterval ? new Date().toISOString() : "";
  const chatIdStr = input.chatId ? String(input.chatId) : "";

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TODOS_SHEET}!A:J`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          taskId,
          createdAt,
          input.task.trim(),
          dueDate,
          priority,
          status,
          completedAt,
          remindInterval,
          lastRemindedAt,
          chatIdStr,
        ],
      ],
    },
  });

  const updatedRange = response.data.updates?.updatedRange ?? "";
  const match = updatedRange.match(/!A(\d+):/);
  const rowNumber = match ? Number(match[1]) : 2;

  return {
    rowNumber,
    taskId,
    createdAt,
    task: input.task.trim(),
    dueDate,
    priority,
    status,
    completedAt,
    remindIntervalMinutes: input.remindIntervalMinutes,
    lastRemindedAt: lastRemindedAt || undefined,
    chatId: input.chatId,
  };
}

export async function listTodos(filter?: {
  date?: string; // YYYY-MM-DD or 'today'
  status?: "active" | "completed" | "all";
}): Promise<TodoItem[]> {
  await ensureTodosSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TODOS_SHEET}!A2:J`,
  });

  const rows = (response.data.values ?? []) as string[][];

  const targetStatus = filter?.status ?? "active";
  const targetDate =
    filter?.date === "today" ? getSingaporeTodayDate() : filter?.date;

  return rows
    .map((row, index) => rowToTodo(row, index + 2))
    .filter((item) => {
      if (item.taskId === "") return false;
      if (targetStatus !== "all" && item.status !== targetStatus) return false;
      if (targetDate) {
        // If a specific date is requested, show tasks due on or before that date, or due today, or without a due date if querying today
        if (item.dueDate && item.dueDate !== targetDate && item.dueDate > targetDate) {
          return false;
        }
      }
      return true;
    });
}

export async function getTodoById(taskId: string): Promise<TodoItem | null> {
  await ensureTodosSheetExists();

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TODOS_SHEET}!A2:J`,
  });

  const rows = (response.data.values ?? []) as string[][];

  for (let i = 0; i < rows.length; i++) {
    const todo = rowToTodo(rows[i], i + 2);
    if (todo.taskId.toLowerCase() === taskId.toLowerCase().trim()) {
      return todo;
    }
  }

  return null;
}

export async function searchActiveTodos(query: string): Promise<TodoItem[]> {
  const activeTodos = await listTodos({ status: "active" });
  const q = query.trim().toLowerCase();

  if (!q) return activeTodos;

  return activeTodos.filter(
    (t) =>
      t.task.toLowerCase().includes(q) ||
      t.taskId.toLowerCase() === q ||
      t.dueDate.toLowerCase().includes(q)
  );
}

export async function completeTodo(
  taskId: string
): Promise<{ success: boolean; todo?: TodoItem }> {
  await ensureTodosSheetExists();

  const todo = await getTodoById(taskId);
  if (!todo) {
    return { success: false };
  }

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const completedAt = formatSingaporeTimestamp();

  // Column F is Status (index 5 -> Col F), Column G is Completed At (index 6 -> Col G)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TODOS_SHEET}!F${todo.rowNumber}:G${todo.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["completed", completedAt]],
    },
  });

  return {
    success: true,
    todo: {
      ...todo,
      status: "completed",
      completedAt,
    },
  };
}

export async function deleteTodo(
  taskId: string
): Promise<{ success: boolean; todo?: TodoItem }> {
  await ensureTodosSheetExists();

  const todo = await getTodoById(taskId);
  if (!todo) {
    return { success: false };
  }

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TODOS_SHEET}!F${todo.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [["deleted"]],
    },
  });

  return {
    success: true,
    todo: {
      ...todo,
      status: "deleted",
    },
  };
}

export async function updateTodoLastRemindedAt(
  taskId: string,
  timestamp: string
): Promise<boolean> {
  await ensureTodosSheetExists();

  const todo = await getTodoById(taskId);
  if (!todo) return false;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Column I is Last Reminded At (index 8 -> Col I)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TODOS_SHEET}!I${todo.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[timestamp]],
    },
  });

  return true;
}

export async function muteTodoReminder(taskId: string): Promise<boolean> {
  await ensureTodosSheetExists();

  const todo = await getTodoById(taskId);
  if (!todo) return false;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  // Column H is Remind Interval Mins (index 7 -> Col H)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TODOS_SHEET}!H${todo.rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[""]],
    },
  });

  return true;
}

export type TodoReminderCheckResult = {
  todosChecked: number;
  remindersSent: number;
  sentTodos: Array<{
    taskId: string;
    task: string;
    remindIntervalMinutes: number;
  }>;
};

export async function checkAndSendTodoReminders(): Promise<TodoReminderCheckResult> {
  const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  const activeTodos = await listTodos({ status: "active" });

  const now = new Date();
  let todosChecked = 0;
  let remindersSent = 0;
  const sentTodos: TodoReminderCheckResult["sentTodos"] = [];

  for (const todo of activeTodos) {
    if (!todo.remindIntervalMinutes || todo.remindIntervalMinutes <= 0) {
      continue;
    }
    todosChecked++;

    const intervalMinutes = todo.remindIntervalMinutes;
    const intervalMs = intervalMinutes * 60 * 1000;

    let lastTime = 0;
    if (todo.lastRemindedAt) {
      const parsed = new Date(todo.lastRemindedAt).getTime();
      lastTime = Number.isNaN(parsed) ? 0 : parsed;
    }

    const timeSinceLastRemindedMs = now.getTime() - lastTime;
    // If lastTime is set, require intervalMs to have elapsed
    if (lastTime > 0 && timeSinceLastRemindedMs < intervalMs) {
      continue;
    }

    const targetChatId = todo.chatId || allowedUserId;
    if (!targetChatId) {
      continue;
    }

    const message = [
      `⏰ *Task Reminder!*`,
      "",
      `• *${todo.task}*`,
      todo.dueDate ? `📅 Due: ${todo.dueDate}` : "",
      "",
      `🔁 _Reminding every ${intervalMinutes} mins until completed._`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await sendTelegramMessage(targetChatId, message, {
        inline_keyboard: [
          [
            {
              text: "✅ Mark Done",
              callback_data: `todo_done:${todo.taskId}`,
            },
            {
              text: "🔕 Mute Reminder",
              callback_data: `todo_mute:${todo.taskId}`,
            },
          ],
        ],
      });

      const nowIso = now.toISOString();
      await updateTodoLastRemindedAt(todo.taskId, nowIso);

      remindersSent++;
      sentTodos.push({
        taskId: todo.taskId,
        task: todo.task,
        remindIntervalMinutes: intervalMinutes,
      });
    } catch (err) {
      console.error(`Failed to send reminder for task ${todo.taskId}:`, err);
    }
  }

  return {
    todosChecked,
    remindersSent,
    sentTodos,
  };
}
