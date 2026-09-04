import { getSheetsClient } from "./google";

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
};

export type AddTodoInput = {
  task: string;
  dueDate?: string;
  priority?: "low" | "medium" | "high";
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
      range: `${TODOS_SHEET}!A1:G1`,
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
          ],
        ],
      },
    });
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

  return {
    rowNumber,
    taskId: normaliseCell(row[0]),
    createdAt: normaliseCell(row[1]),
    task: normaliseCell(row[2]),
    dueDate: normaliseCell(row[3]),
    priority,
    status,
    completedAt: normaliseCell(row[6]),
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

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TODOS_SHEET}!A:G`,
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
    range: `${TODOS_SHEET}!A2:G`,
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
    range: `${TODOS_SHEET}!A2:G`,
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
