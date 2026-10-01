import type { AssistantIntent } from "../assistant-intent";
import type { FinanceTransaction } from "../finance";
import {
  getTransactionById,
  searchActiveTransactions,
  updateTransaction,
} from "../finance";
import { moveCalendarEvent } from "../calendar";
import {
  handleFinanceAddAction,
  handleFinanceSummaryAction,
  handleFinanceDeleteSearchAction,
  handleFinanceQueryAction,
} from "./finance-handler";
import {
  formatCalendarDate,
  formatSingaporeDateTime,
  handleCalendarViewAction,
  handleCalendarAddAction,
  handleCalendarBatchAddAction,
  handleCalendarDeleteSearchAction,
  handleCalendarRescheduleAction,
  handleCalendarRescheduleCallback,
  handleCalendarFreeSlotsAction,
} from "./calendar-handler";
import {
  handleTodoAddAction,
  handleTodoViewAction,
  handleTodoCompleteAction,
  handleTodoDeleteSearchAction,
} from "./todo-handler";
import {
  handleEmailDraftAction,
  handleEmailSendCallback,
} from "./draft-handler";
import {
  handleSplitBillAction,
  handleIOUSummaryAction,
  handleIOUSettleCallback,
} from "./split-handler";
import {
  handleMemorySaveAction,
  handleMemoryRecallAction,
} from "./memory-handler";
import {
  handleRecurringAddAction,
  handleRecurringViewAction,
  handleRecurringToggleCallback,
} from "./recurring-handler";
import { handleBudgetSetAction } from "./budget-handler";
import {
  handleWorkoutStartAction,
  handleWorkoutLogAction,
  handleWorkoutViewAction,
} from "../workout/workout-handler";
import { executeUndo, executeLatestUndo } from "../undo";
import { logHabitDone } from "../habits";
import {
  answerTelegramCallback,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
} from "../telegram";

import type { UserCalendarContext } from "../pending-actions";

export interface IntentContext {
  chatId: number;
  userId: number;
  updateId: number;
  text: string;
  messageDateObj: Date;
  userCalendarContext: UserCalendarContext;
  targetTransaction?: FinanceTransaction | null;
}

export interface CallbackContext {
  callbackId: string;
  callbackData: string;
  action: string;
  token?: string;
  parts: string[];
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
  startedAt: number;
}

export type IntentHandlerFn<T = AssistantIntent> = (
  ctx: IntentContext,
  intent: T
) => Promise<{ completionStatus: string } | void>;

export type CallbackHandlerFn = (ctx: CallbackContext) => Promise<boolean>;

export class HandlerRegistry {
  private intentHandlers = new Map<string, IntentHandlerFn<AssistantIntent>>();
  private callbackHandlers = new Map<string, CallbackHandlerFn>();

  registerIntent<K extends AssistantIntent["action"]>(
    action: K,
    handler: IntentHandlerFn<Extract<AssistantIntent, { action: K }>>
  ): this {
    this.intentHandlers.set(
      action,
      handler as unknown as IntentHandlerFn<AssistantIntent>
    );
    return this;
  }

  registerCallback(prefix: string, handler: CallbackHandlerFn): this {
    this.callbackHandlers.set(prefix, handler);
    return this;
  }

  async dispatchIntent(
    ctx: IntentContext,
    intent: AssistantIntent
  ): Promise<{ handled: boolean; completionStatus?: string }> {
    const handler = this.intentHandlers.get(intent.action);
    if (!handler) {
      return { handled: false };
    }

    const result = await handler(ctx, intent);
    return {
      handled: true,
      completionStatus: result?.completionStatus,
    };
  }

  async dispatchCallback(ctx: CallbackContext): Promise<boolean> {
    const handler = this.callbackHandlers.get(ctx.action);
    if (handler) {
      return await handler(ctx);
    }

    for (const [prefix, h] of this.callbackHandlers.entries()) {
      if (ctx.action.startsWith(prefix) || ctx.callbackData.startsWith(prefix)) {
        return await h(ctx);
      }
    }

    return false;
  }
}

export const defaultRegistry = new HandlerRegistry();

// Initialize default domain handlers
defaultRegistry
  .registerIntent("finance_add", async (ctx, intent) => {
    await handleFinanceAddAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      intent,
      messageDateObj: ctx.messageDateObj,
    });
    return { completionStatus: "finance_add_natural_language" };
  })
  .registerIntent("calendar_view", async (ctx, intent) => {
    await handleCalendarViewAction({
      chatId: ctx.chatId,
      calendarName: intent.calendarName,
      timeframe: intent.timeframe,
      text: ctx.text,
    });
    return { completionStatus: "calendar_view" };
  })
  .registerIntent("finance_summary", async (ctx, intent) => {
    await handleFinanceSummaryAction({
      chatId: ctx.chatId,
      period: intent.period,
    });
    return { completionStatus: "finance_summary" };
  })
  .registerIntent("finance_query", async (ctx, intent) => {
    await handleFinanceQueryAction({
      chatId: ctx.chatId,
      intent,
    });
    return { completionStatus: "finance_query" };
  })
  .registerIntent("calendar_add", async (ctx, intent) => {
    await handleCalendarAddAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      intent,
      hasActivePending: Boolean(ctx.userCalendarContext.activePending),
    });
    return { completionStatus: "calendar_add_pending" };
  })
  .registerIntent("calendar_batch_add", async (ctx, intent) => {
    await handleCalendarBatchAddAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      intent,
      hasActivePending: Boolean(ctx.userCalendarContext.activePending),
    });
    return { completionStatus: "calendar_batch_pending" };
  })
  .registerIntent("finance_delete_search", async (ctx, intent) => {
    const resolvedTxnId =
      intent.transactionId ||
      (ctx.text.toLowerCase().includes("this") || ctx.text.toLowerCase().includes("that")
        ? ctx.targetTransaction?.transactionId
        : undefined);

    const status = await handleFinanceDeleteSearchAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      resolvedTxnId,
      query: intent.query || ctx.text,
    });

    const completionStatus =
      status === "confirmed"
        ? "finance_delete_direct_confirmation_sent"
        : status === "empty"
        ? "finance_delete_search_empty"
        : "finance_delete_search_found";

    return { completionStatus };
  })
  .registerIntent("calendar_delete_search", async (ctx, intent) => {
    const found = await handleCalendarDeleteSearchAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      intent,
    });
    return {
      completionStatus: found
        ? "calendar_delete_search_found"
        : "calendar_delete_search_empty",
    };
  })
  .registerIntent("calendar_reschedule", async (ctx, intent) => {
    await handleCalendarRescheduleAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      intent,
    });
    return { completionStatus: "calendar_reschedule_prompt" };
  })
  .registerIntent("calendar_free_slots", async (ctx, intent) => {
    await handleCalendarFreeSlotsAction({
      chatId: ctx.chatId,
      intent,
    });
    return { completionStatus: "calendar_free_slots" };
  })
  .registerIntent("todo_add", async (ctx, intent) => {
    await handleTodoAddAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      task: intent.task,
      tasks: intent.tasks,
      dueDate: intent.dueDate,
      priority: intent.priority,
      remindIntervalMinutes: intent.remindIntervalMinutes,
    });
    return { completionStatus: "todo_add_natural_language" };
  })
  .registerIntent("todo_view", async (ctx, intent) => {
    await handleTodoViewAction({
      chatId: ctx.chatId,
      timeframe: intent.timeframe,
    });
    return { completionStatus: "todo_view_natural_language" };
  })
  .registerIntent("todo_complete", async (ctx, intent) => {
    await handleTodoCompleteAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      query: intent.query,
    });
    return { completionStatus: "todo_complete_natural_language" };
  })
  .registerIntent("todo_delete_search", async (ctx, intent) => {
    const status = await handleTodoDeleteSearchAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      query: intent.query,
    });
    return {
      completionStatus:
        status === "empty"
          ? "todo_delete_search_empty"
          : status === "prompt"
          ? "todo_delete_prompt"
          : "todo_delete_selection_prompt",
    };
  })
  .registerIntent("email_draft", async (ctx, intent) => {
    await handleEmailDraftAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      intent: {
        to: intent.to,
        subject: intent.subject,
        body: intent.body,
        cc: intent.cc,
        bcc: intent.bcc,
      },
    });
    return { completionStatus: "email_draft_prompt" };
  })
  .registerIntent("split_bill", async (ctx, intent) => {
    await handleSplitBillAction({
      chatId: ctx.chatId,
      intent,
    });
    return { completionStatus: "split_bill" };
  })
  .registerIntent("iou_summary", async (ctx, intent) => {
    await handleIOUSummaryAction({
      chatId: ctx.chatId,
      person: intent.person,
    });
    return { completionStatus: "iou_summary" };
  })
  .registerIntent("memory_save", async (ctx, intent) => {
    await handleMemorySaveAction({
      chatId: ctx.chatId,
      intent,
    });
    return { completionStatus: "memory_save" };
  })
  .registerIntent("memory_recall", async (ctx, intent) => {
    await handleMemoryRecallAction({
      chatId: ctx.chatId,
      intent,
    });
    return { completionStatus: "memory_recall" };
  })
  .registerIntent("recurring_add", async (ctx, intent) => {
    await handleRecurringAddAction({
      chatId: ctx.chatId,
      intent: {
        type: intent.type,
        title: intent.title,
        frequency: intent.frequency,
        amount: intent.amount,
        currency: intent.currency,
        category: intent.category,
        dayOfMonth: intent.dayOfMonth,
        dayOfWeek: intent.dayOfWeek,
      },
    });
    return { completionStatus: "recurring_add" };
  })
  .registerIntent("recurring_view", async (ctx) => {
    await handleRecurringViewAction({ chatId: ctx.chatId });
    return { completionStatus: "recurring_view" };
  })
  .registerIntent("finance_modify", async (ctx, intent) => {
    const resolvedTxnId =
      intent.transactionId ||
      (ctx.text.toLowerCase().includes("this") || ctx.text.toLowerCase().includes("that")
        ? ctx.targetTransaction?.transactionId
        : undefined);

    let transaction: FinanceTransaction | null = null;
    if (resolvedTxnId) {
      transaction = await getTransactionById(resolvedTxnId);
    }
    if (!transaction && intent.query) {
      const matches = await searchActiveTransactions(intent.query);
      if (matches.length > 0) {
        transaction = matches[0];
      }
    }
    if (!transaction) {
      transaction = ctx.targetTransaction || null;
    }

    if (!transaction) {
      await sendTelegramMessage(
        ctx.chatId,
        "I couldn't find the transaction you want to modify. Please specify the description or reply to the transaction message."
      );
      return { completionStatus: "finance_modify_not_found" };
    }

    if (
      intent.updates.description &&
      transaction.description &&
      (transaction.description.includes("(DBS PayLah)") ||
        transaction.description.includes("(Apple Pay)")) &&
      !intent.updates.description.includes("(DBS PayLah)") &&
      !intent.updates.description.includes("(Apple Pay)")
    ) {
      const currentDesc = transaction.description;
      const item = intent.updates.description.trim();
      if (currentDesc.includes(" @ ")) {
        const parts = currentDesc.split(" @ ");
        intent.updates.description = `${item} @ ${parts.slice(1).join(" @ ")}`;
      } else {
        intent.updates.description = `${item} @ ${currentDesc}`;
      }
    }

    const updated = await updateTransaction(transaction.transactionId, intent.updates);
    if (!updated) {
      await sendTelegramMessage(
        ctx.chatId,
        `Failed to update transaction ${transaction.transactionId}. It may have already been deleted.`
      );
      return { completionStatus: "finance_modify_failed" };
    }

    await sendTelegramMessage(
      ctx.chatId,
      [
        "✅ Transaction updated!",
        "",
        `Type: ${updated.type}`,
        `Amount: ${Number(updated.amount).toFixed(2)} ${updated.currency}`,
        `Category: ${updated.category}`,
        `Description: ${updated.description}`,
        `Date & Time: ${updated.timestamp} (SGT)`,
      ].join("\n")
    );
    return { completionStatus: "finance_modify_success" };
  })
  .registerIntent("calendar_move", async (ctx, intent) => {
    try {
      const moveRes = await moveCalendarEvent({
        fromCalendar: intent.fromCalendar,
        toCalendar: intent.toCalendar,
        title: intent.title,
        eventId: intent.eventId,
        allDay: intent.allDay,
        start: intent.start,
        end: intent.end,
        date: intent.date,
      });

      const fromBadge = intent.fromCalendar === "work" ? "💼 Work" : "🏠 Personal";
      const toBadge = intent.toCalendar === "work" ? "💼 Work" : "🏠 Personal";
      const timingLine = moveRes.allDay
        ? `Date: ${formatCalendarDate(moveRes.start)} (All day)`
        : `Start: ${formatSingaporeDateTime(moveRes.start)}\nEnd: ${formatSingaporeDateTime(moveRes.end ?? "")}`;

      await sendTelegramMessage(
        ctx.chatId,
        [
          `✅ Moved event from ${fromBadge} to ${toBadge}!`,
          "",
          `Title: ${moveRes.title}`,
          timingLine,
          moveRes.htmlLink ? `Link: ${moveRes.htmlLink}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return { completionStatus: "calendar_move" };
    } catch (moveError) {
      await sendTelegramMessage(
        ctx.chatId,
        `Sorry, I couldn't move "${intent.title}" to ${intent.toCalendar}: ${
          moveError instanceof Error ? moveError.message : "Unknown error"
        }`
      );
      return { completionStatus: "calendar_move_failed" };
    }
  })
  .registerIntent("budget_set", async (ctx, intent) => {
    await handleBudgetSetAction({
      chatId: ctx.chatId,
      intent: { amount: intent.amount, category: intent.category },
    });
    return { completionStatus: "budget_set" };
  })
  .registerIntent("workout_start", async (ctx, intent) => {
    await handleWorkoutStartAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      location: intent.location,
    });
    return { completionStatus: "workout_start" };
  })
  .registerIntent("workout_log", async (ctx, intent) => {
    await handleWorkoutLogAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      text: intent.text,
      location: intent.location,
    });
    return { completionStatus: "workout_log" };
  })
  .registerIntent("workout_view", async (ctx) => {
    await handleWorkoutViewAction({
      chatId: ctx.chatId,
    });
    return { completionStatus: "workout_view" };
  })
  .registerIntent("undo", async (ctx) => {
    const res = await executeLatestUndo(ctx.userId);
    await sendTelegramMessage(ctx.chatId, res.message);
    return { completionStatus: "undo_conversational" };
  })
  .registerCallback("gym_loc", async (ctx) => {
    const location = (ctx.parts[1] || "school") as "school" | "csc";
    await answerTelegramCallback(ctx.callbackId, `Setting up ${location} workout...`);
    await removeTelegramInlineKeyboard(ctx.chatId, ctx.messageId);
    await handleWorkoutStartAction({
      chatId: ctx.chatId,
      userId: ctx.userId,
      location,
    });
    return true;
  })
  .registerCallback("cal_resched_yes", (ctx) =>
    handleCalendarRescheduleCallback({
      callbackId: ctx.callbackId,
      callbackData: ctx.callbackData,
      userId: ctx.userId,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
    })
  )
  .registerCallback("cal_resched_no", (ctx) =>
    handleCalendarRescheduleCallback({
      callbackId: ctx.callbackId,
      callbackData: ctx.callbackData,
      userId: ctx.userId,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
    })
  )
  .registerCallback("recurring_toggle", (ctx) =>
    handleRecurringToggleCallback({
      callbackId: ctx.callbackId,
      callbackData: ctx.callbackData,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
    })
  )
  .registerCallback("iou_settle", async (ctx) => {
    return await handleIOUSettleCallback({
      callbackId: ctx.callbackId,
      callbackData: ctx.callbackData,
      chatId: ctx.chatId,
    });
  })
  .registerCallback("email_send", async (ctx) => {
    return await handleEmailSendCallback({
      callbackId: ctx.callbackId,
      callbackData: ctx.callbackData,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
    });
  })
  .registerCallback("undo", async (ctx) => {
    const parts = ctx.callbackData.split(":");
    const token = parts[1];
    if (!token) {
      await answerTelegramCallback(ctx.callbackId, "Invalid undo request.");
      return true;
    }
    const result = await executeUndo(token, ctx.userId);
    await answerTelegramCallback(
      ctx.callbackId,
      result.success ? "Action undone!" : "Could not undo."
    );
    if (result.success) {
      await removeTelegramInlineKeyboard(ctx.chatId, ctx.messageId);
    }
    await sendTelegramMessage(ctx.chatId, result.message);
    return true;
  })
  .registerCallback("habit_done", async (ctx) => {
    const parts = ctx.callbackData.split(":");
    const habitId = parts[1];
    if (!habitId) {
      await answerTelegramCallback(ctx.callbackId, "Invalid habit ID.");
      return true;
    }
    const res = await logHabitDone(habitId);
    await answerTelegramCallback(
      ctx.callbackId,
      res.alreadyDoneToday ? "Already checked today!" : "Habit checked!"
    );
    await removeTelegramInlineKeyboard(ctx.chatId, ctx.messageId);
    await sendTelegramMessage(ctx.chatId, res.message);
    return true;
  });


