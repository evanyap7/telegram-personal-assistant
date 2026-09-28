import { deleteCalendarEvent } from "@/lib/calendar";
import { uncompleteTodo, deleteTodo } from "@/lib/todos";
import {
  saveUndoAction,
  takeUndoAction,
  type UndoPayload,
} from "@/lib/pending-actions";

export type UndoActionType = UndoPayload["type"];

/**
 * Registers an undoable action and returns its token. Tokens live in the
 * PendingActions sheet (10 minute expiry, single use) so they survive
 * serverless cold starts and cross-instance callbacks.
 */
export async function registerUndoAction(
  userId: number | string,
  action: UndoPayload
): Promise<string> {
  return saveUndoAction({ userId: Number(userId), payload: action });
}

export async function executeUndo(
  token: string,
  userId: number | string
): Promise<{ success: boolean; message: string }> {
  const action = await takeUndoAction(token, Number(userId));

  if (!action) {
    return {
      success: false,
      message: "⚠️ This undo action has expired or has already been used.",
    };
  }

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
