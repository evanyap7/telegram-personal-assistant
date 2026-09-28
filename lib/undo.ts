import { deleteCalendarEvent } from "@/lib/calendar";
import { uncompleteTodo, deleteTodo } from "@/lib/todos";

export type UndoActionType =
  | "calendar_event_created"
  | "todo_completed"
  | "todo_created";

export interface UndoAction {
  id: string;
  userId: string;
  type: UndoActionType;
  description: string;
  createdAt: number;
  data: Record<string, any>;
}

// In-memory store for recent undoable actions (10 minute expiry)
const undoStore = new Map<string, UndoAction>();
const UNDO_TTL_MS = 10 * 60 * 1000;

function cleanupExpired() {
  const now = Date.now();
  for (const [id, action] of undoStore.entries()) {
    if (now - action.createdAt > UNDO_TTL_MS) {
      undoStore.delete(id);
    }
  }
}

export function registerUndoAction(
  userId: number | string,
  action: Omit<UndoAction, "id" | "userId" | "createdAt">
): string {
  cleanupExpired();
  const id = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  undoStore.set(id, {
    ...action,
    id,
    userId: String(userId),
    createdAt: Date.now(),
  });
  return id;
}

export function getUndoAction(token: string): UndoAction | undefined {
  cleanupExpired();
  return undoStore.get(token);
}

export async function executeUndo(
  token: string,
  userId: number | string
): Promise<{ success: boolean; message: string }> {
  cleanupExpired();
  const action = undoStore.get(token);

  if (!action) {
    return {
      success: false,
      message: "⚠️ This undo action has expired or has already been used.",
    };
  }

  if (action.userId !== String(userId)) {
    return {
      success: false,
      message: "⚠️ You are not authorized to undo this action.",
    };
  }

  undoStore.delete(token);

  try {
    switch (action.type) {
      case "calendar_event_created": {
        const { calendarName, eventId } = action.data;
        if (!eventId) {
          return { success: false, message: "Missing event ID for calendar undo." };
        }
        await deleteCalendarEvent({
          calendarName: calendarName === "work" ? "work" : "personal",
          eventId,
        });
        return {
          success: true,
          message: `↩️ Undone: Deleted created calendar event (${action.description}).`,
        };
      }

      case "todo_completed": {
        const { taskId } = action.data;
        if (!taskId) {
          return { success: false, message: "Missing task ID for todo undo." };
        }
        const res = await uncompleteTodo(taskId);
        if (!res.success) {
          return { success: false, message: "Failed to restore task." };
        }
        return {
          success: true,
          message: `↩️ Undone: Reopened task "${res.todo?.task ?? action.description}".`,
        };
      }

      case "todo_created": {
        const { taskId } = action.data;
        if (!taskId) {
          return { success: false, message: "Missing task ID for todo undo." };
        }
        await deleteTodo(taskId);
        return {
          success: true,
          message: `↩️ Undone: Removed newly created task (${action.description}).`,
        };
      }

      default:
        return { success: false, message: "Unknown undo action type." };
    }
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      message: `Failed to undo action: ${errMessage}`,
    };
  }
}

export function buildUndoInlineKeyboard(undoToken: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "↩️ Undo",
          callback_data: `undo:${undoToken}`,
        },
      ],
    ],
  };
}
