import { deleteCalendarEvent } from "./calendar";
import { uncompleteTodo, deleteTodo } from "./todos";
import { softDeleteTransaction } from "./finance";
import {
  saveUndoAction,
  takeUndoAction,
  takeLatestUndoAction,
  type UndoPayload,
} from "./pending-actions";

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

async function executeUndoPayload(
  action: UndoPayload
): Promise<{ success: boolean; message: string }> {
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
          message: `↩️ Undone: Deleted calendar event (${action.description}).`,
        };
      }

      case "calendar_batch_created": {
        const calendarName = action.data.calendarName === "work" ? "work" : "personal";
        const eventIds: string[] = JSON.parse(action.data.eventIds || "[]");
        await Promise.all(
          eventIds.map((eventId) => deleteCalendarEvent({ calendarName, eventId }))
        );
        return {
          success: true,
          message: `↩️ Undone: Deleted ${eventIds.length} created calendar events.`,
        };
      }

      case "finance_transaction_created": {
        const { transactionId } = action.data;
        if (!transactionId) {
          return { success: false, message: "Missing transaction ID for finance undo." };
        }
        await softDeleteTransaction(transactionId);
        return {
          success: true,
          message: `↩️ Undone: Removed transaction (${action.description}).`,
        };
      }

      case "finance_batch_created": {
        const transactionIds: string[] = JSON.parse(action.data.transactionIds || "[]");
        await Promise.all(transactionIds.map((id) => softDeleteTransaction(id)));
        return {
          success: true,
          message: `↩️ Undone: Removed ${transactionIds.length} logged transactions.`,
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
          message: `↩️ Undone: Removed task (${action.description}).`,
        };
      }

      case "todo_batch_created": {
        const taskIds: string[] = JSON.parse(action.data.taskIds || "[]");
        await Promise.all(taskIds.map((id) => deleteTodo(id)));
        return {
          success: true,
          message: `↩️ Undone: Removed ${taskIds.length} newly added tasks.`,
        };
      }

      case "workout_logged": {
        const { deleteWorkoutRows } = await import("./workout/workout-service");
        const rowIds: string[] = JSON.parse(action.data.rowIds || "[]");
        await deleteWorkoutRows(rowIds);
        return {
          success: true,
          message: `↩️ Undone: Reverted logged workout (${action.description}).`,
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

  return executeUndoPayload(action);
}

export async function executeLatestUndo(
  userId: number | string
): Promise<{ success: boolean; message: string }> {
  const latest = await takeLatestUndoAction(Number(userId));
  if (!latest) {
    return {
      success: false,
      message: "⚠️ No recent actions found to undo (or action has expired).",
    };
  }
  return executeUndoPayload(latest.payload);
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
