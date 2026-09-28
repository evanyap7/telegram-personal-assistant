import type { AssistantIntent } from "../assistant-intent";
import type { FinanceTransaction } from "../finance";
import {
  handleFinanceAddAction,
  handleFinanceSummaryAction,
  handleFinanceDeleteSearchAction,
  handleFinanceQueryAction,
} from "./finance-handler";
import {
  handleCalendarViewAction,
  handleCalendarAddAction,
  handleCalendarBatchAddAction,
  handleCalendarDeleteSearchAction,
} from "./calendar-handler";
import {
  handleTodoAddAction,
  handleTodoViewAction,
  handleTodoCompleteAction,
  handleTodoDeleteSearchAction,
} from "./todo-handler";
import { handleEmailDraftAction } from "./draft-handler";
import {
  handleSplitBillAction,
  handleIOUSummaryAction,
  handleIOUSettleCallback,
} from "./split-handler";

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
  private intentHandlers = new Map<string, IntentHandlerFn<any>>();
  private callbackHandlers = new Map<string, CallbackHandlerFn>();

  registerIntent<K extends AssistantIntent["action"]>(
    action: K,
    handler: IntentHandlerFn<Extract<AssistantIntent, { action: K }>>
  ): this {
    this.intentHandlers.set(action, handler as IntentHandlerFn<any>);
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
  .registerIntent("todo_add", async (ctx, intent) => {
    await handleTodoAddAction({
      chatId: ctx.chatId,
      task: intent.task,
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
  .registerCallback("iou_settle", async (ctx) => {
    return await handleIOUSettleCallback({
      callbackId: ctx.callbackId,
      callbackData: ctx.callbackData,
      chatId: ctx.chatId,
    });
  });
