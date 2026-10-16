import { google } from "@ai-sdk/google";
import { ToolLoopAgent, isStepCount } from "ai";
import { runFinanceAgent } from "@/lib/agent/finance-agent";
import { runWorkoutAgent } from "@/lib/agent/workout-agent";
import { buildEgoTools } from "@/lib/agent/ego-tools";
import {
  buildEgoInstructions,
  describeWorkoutContext,
  dropCurrentTurn,
  toConversationMessages,
} from "@/lib/agent/ego-prompt";
import {
  createReplyTracker,
  resolveFailureReply,
  resolveFinalReply,
} from "@/lib/agent/ego-reply";
import type { InputMode } from "@/lib/agent/input-mode";
import type { ConversationContext } from "@/lib/assistant-intent";
import type { FormattedChatTurn } from "@/lib/chat-history";
import type { FinanceTransaction } from "@/lib/finance";
import { defaultRegistry, type IntentContext } from "@/lib/handlers/dispatcher";
import { processAssistantImages } from "@/lib/handlers/media-handler";
import {
  consumePendingImage,
  getLatestPendingImage,
  type UserCalendarContext,
} from "@/lib/pending-actions";
import { answerWithSearch } from "@/lib/search";
import { sendTelegramMessage } from "@/lib/telegram";
import { loadSession } from "@/lib/workout/workout-session";

export interface EgoRunInput {
  chatId: number;
  userId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
  messageDate: Date;
  history: FormattedChatTurn[];
  userCalendarContext: UserCalendarContext;
  targetTransaction: FinanceTransaction | null;
  repliedToText?: string;
  repliedPhotoFileIds?: string[];
  hasPendingImage: boolean;
}

const MAX_STATUS_LENGTH = 100;

export async function runEgo(input: EgoRunInput): Promise<{ completionStatus: string }> {
  const { chatId, userId, updateId, text, inputMode } = input;
  const tracker = createReplyTracker();
  const toolsUsed: string[] = [];

  const workoutState = await loadSession().catch(() => null);

  const intentContext: IntentContext = {
    chatId,
    userId,
    updateId,
    text,
    messageDateObj: input.messageDate,
    userCalendarContext: input.userCalendarContext,
    targetTransaction: input.targetTransaction,
  };
  const priorHistory = dropCurrentTurn(input.history, text);

  const tools = buildEgoTools({
    dispatchIntent: (intent) => defaultRegistry.dispatchIntent(intentContext, intent),
    askFinance: async (request) => {
      const result = await runFinanceAgent({
        chatId,
        userId,
        text: request,
        targetTransaction: input.targetTransaction,
        repliedToText: input.repliedToText,
        history: priorHistory,
        inputMode,
        messageDate: input.messageDate,
      });
      return result.handled;
    },
    askWorkout: async ({ kind, request, location }) => {
      if (kind === "session_message") {
        const result = await runWorkoutAgent({ chatId, text: request, inputMode });
        return result.handled;
      }
      const intent =
        kind === "start"
          ? ({ action: "workout_start", location } as const)
          : kind === "log"
            ? ({ action: "workout_log", text: request, location } as const)
            : ({ action: "workout_view" } as const);
      const result = await defaultRegistry.dispatchIntent(intentContext, intent);
      return result.handled;
    },
    search: async (query) => (await answerWithSearch(query)).answer,
    processPendingImage: async (instruction) => {
      let fileIds = input.repliedPhotoFileIds;
      if (!fileIds?.length) {
        const pending = await getLatestPendingImage(userId);
        if (!pending) return false;
        fileIds = pending.payload.fileIds?.length
          ? pending.payload.fileIds
          : [pending.payload.fileId];
        await consumePendingImage(pending.token);
      }
      return processAssistantImages({ chatId, userId, fileIds, instruction, updateId });
    },
    markNotified: () => tracker.markNotified(),
    onToolCall: (name) => toolsUsed.push(name),
  });

  const context: ConversationContext = {
    messageTime: input.messageDate,
    repliedMessageText: input.repliedToText,
    activePendingCalendar: input.userCalendarContext.activePending?.payload,
    recentCalendarEvent: input.userCalendarContext.recentConfirmed,
    recentTransaction: input.targetTransaction
      ? {
          transactionId: input.targetTransaction.transactionId,
          type: input.targetTransaction.type,
          amount: input.targetTransaction.amount,
          currency: input.targetTransaction.currency,
          category: input.targetTransaction.category,
          description: input.targetTransaction.description,
          timestamp: input.targetTransaction.timestamp,
        }
      : undefined,
  };

  const agent = new ToolLoopAgent({
    model: google("gemini-3.6-flash"),
    instructions: buildEgoInstructions({
      now: input.messageDate,
      inputMode,
      context,
      workoutLine: describeWorkoutContext(workoutState),
      hasPendingImage: input.hasPendingImage,
      repliedToPhoto: Boolean(input.repliedPhotoFileIds?.length),
    }),
    tools,
    stopWhen: isStepCount(10),
    temperature: 0,
  });

  let result;
  try {
    result = await agent.generate({ messages: toConversationMessages(input.history, text) });
  } catch (error) {
    // A tool may already have changed something and messaged the user; a generic
    // "try again" from the route would invite a duplicate.
    const partial = resolveFailureReply(tracker.notified);
    if (!partial) throw error;
    console.error("EGO run failed after tools already ran:", error);
    await sendTelegramMessage(chatId, partial, undefined, null);
    return { completionStatus: "ego_partial_failure" };
  }

  const reply = resolveFinalReply({ text: result.text, notified: tracker.notified });
  if (reply) {
    await sendTelegramMessage(chatId, reply, undefined, null);
  }

  const status = toolsUsed.length
    ? `ego:${[...new Set(toolsUsed)].join(",")}`
    : "ego_replied";
  return { completionStatus: status.slice(0, MAX_STATUS_LENGTH) };
}
