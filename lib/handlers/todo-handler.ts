import {
  addTodo,
  completeTodo,
  listTodos,
  searchActiveTodos,
  type TodoItem,
} from "../todos";
import { sendTelegramMessage } from "../telegram";
import {
  savePendingTodoDeleteAction,
  savePendingTodoSelection,
} from "../pending-actions";
import { formatCalendarDate } from "./calendar-handler";

function truncateButtonText(text: string, maxLength = 40): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function formatTodoListMessage(
  todos: TodoItem[],
  title: string
): {
  text: string;
  replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] };
} {
  if (todos.length === 0) {
    return {
      text: `📝 ${title}\n\n🎉 No pending tasks found! You're all caught up.`,
    };
  }

  const lines = [`📝 ${title} (${todos.length}):`, ""];
  const buttons: { text: string; callback_data: string }[][] = [];

  todos.forEach((todo, idx) => {
    const priorityIcon =
      todo.priority === "high" ? "🔴 " : todo.priority === "low" ? "🟢 " : "";
    const dueStr = todo.dueDate ? ` (📅 ${formatCalendarDate(todo.dueDate)})` : "";
    lines.push(`${idx + 1}. ${priorityIcon}${todo.task}${dueStr}`);

    buttons.push([
      {
        text: `✅ Done: ${truncateButtonText(todo.task, 32)}`,
        callback_data: `todo_done:${todo.taskId}`,
      },
    ]);
  });

  return {
    text: lines.join("\n"),
    replyMarkup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
  };
}

export async function handleTodoAddAction(params: {
  chatId: number;
  task: string;
  dueDate?: string;
  priority?: "low" | "medium" | "high";
  remindIntervalMinutes?: number;
}): Promise<TodoItem> {
  const { chatId, task, dueDate, priority, remindIntervalMinutes } = params;

  const todo = await addTodo({
    task,
    dueDate,
    priority,
    remindIntervalMinutes,
    chatId,
  });

  const dueStr = todo.dueDate
    ? `\n📅 Due: ${formatCalendarDate(todo.dueDate)}`
    : "";
  const remindStr = todo.remindIntervalMinutes
    ? `\n🔔 Reminder: Every ${todo.remindIntervalMinutes} mins until marked done`
    : "";

  const buttons = [
    {
      text: "✅ Mark Done",
      callback_data: `todo_done:${todo.taskId}`,
    },
  ];
  if (todo.remindIntervalMinutes) {
    buttons.push({
      text: "🔕 Mute",
      callback_data: `todo_mute:${todo.taskId}`,
    });
  }

  await sendTelegramMessage(
    chatId,
    `✅ Added to your to-do list:\n• ${todo.task}${dueStr}${remindStr}`,
    {
      inline_keyboard: [buttons],
    }
  );

  return todo;
}

export async function handleTodoViewAction(params: {
  chatId: number;
  timeframe?: "today" | "all";
}): Promise<void> {
  const { chatId, timeframe } = params;
  const isToday = timeframe === "today";
  const todos = await listTodos({
    date: isToday ? "today" : undefined,
    status: "active",
  });

  const title = isToday ? "Today's To-Do List" : "Active To-Do List";
  const formatted = formatTodoListMessage(todos, title);
  await sendTelegramMessage(chatId, formatted.text, formatted.replyMarkup);
}

export async function handleTodoCompleteAction(params: {
  chatId: number;
  query: string;
}): Promise<"empty" | "single" | "multiple"> {
  const { chatId, query } = params;
  const matches = await searchActiveTodos(query);

  if (matches.length === 0) {
    await sendTelegramMessage(
      chatId,
      `I couldn't find any active tasks matching “${query}”.`
    );
    return "empty";
  }

  if (matches.length === 1) {
    await completeTodo(matches[0].taskId);
    await sendTelegramMessage(
      chatId,
      `✅ Marked as done: “${matches[0].task}”! 🎉`
    );
    return "single";
  }

  await sendTelegramMessage(
    chatId,
    `Found ${matches.length} tasks matching “${query}”. Tap which one you finished:`,
    {
      inline_keyboard: matches.map((m) => [
        {
          text: `✅ ${truncateButtonText(m.task, 40)}`,
          callback_data: `todo_done:${m.taskId}`,
        },
      ]),
    }
  );
  return "multiple";
}

export async function handleTodoDeleteSearchAction(params: {
  chatId: number;
  userId: number;
  query: string;
}): Promise<"empty" | "prompt" | "selection"> {
  const { chatId, userId, query } = params;
  const matches = await searchActiveTodos(query);

  if (matches.length === 0) {
    await sendTelegramMessage(
      chatId,
      `I couldn't find any active tasks matching “${query}” to remove.`
    );
    return "empty";
  }

  if (matches.length === 1) {
    const match = matches[0];
    const token = await savePendingTodoDeleteAction({
      userId,
      payload: {
        taskId: match.taskId,
        task: match.task,
      },
    });

    await sendTelegramMessage(
      chatId,
      `Remove this task from your to-do list?\n\n• ${match.task}`,
      {
        inline_keyboard: [
          [
            {
              text: "🗑️ Yes, remove",
              callback_data: `todo_del_yes:${token}`,
            },
            {
              text: "❌ No, keep",
              callback_data: `todo_del_no:${token}`,
            },
          ],
        ],
      }
    );
    return "prompt";
  }

  const token = await savePendingTodoSelection({
    userId,
    payload: {
      todos: matches.map((m) => ({ taskId: m.taskId, task: m.task })),
    },
  });

  await sendTelegramMessage(
    chatId,
    `Found ${matches.length} tasks matching “${query}”. Which one would you like to remove?`,
    {
      inline_keyboard: matches.map((m, idx) => [
        {
          text: `🗑️ ${truncateButtonText(m.task, 40)}`,
          callback_data: `todo_del_select:${token}:${idx}`,
        },
      ]),
    }
  );
  return "selection";
}
