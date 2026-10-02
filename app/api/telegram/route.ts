import { telegramUpdateSchema } from "@/lib/telegram-types";
import { safeCompare } from "@/lib/security";
import {
  hasProcessedUpdate,
  markUpdateCompleted,
  markUpdateFailed,
  markUpdateStarted,
  parseSwipeReplyTransactionUpdate,
  updateTransaction,
  getLatestTransaction,
} from "@/lib/finance";
import {
  sendTelegramChatAction,
  sendTelegramMessage,
} from "@/lib/telegram";
import {
  cleanupCompletedMediaGroups,
  mediaGroupBatches,
  processAssistantImages,
  recentlyCompletedMediaGroups,
} from "@/lib/handlers/media-handler";
import { dispatchCallback } from "@/lib/telegram/callback-router";
import { dispatchCommand } from "@/lib/telegram/command-router";
import {
  getLatestPendingImage,
  consumePendingImage,
  getLatestUserCalendarContext,
} from "@/lib/pending-actions";
import { getRecentChatHistory, logChatMessage } from "@/lib/chat-history";
import { resolveRepliedTransaction } from "@/lib/handlers/finance-handler";
import { ConversationContext, parseAssistantIntent } from "@/lib/assistant-intent";
import { defaultRegistry } from "@/lib/handlers/dispatcher";
import { answerWithSearch } from "@/lib/search";
import { handleVoiceNoteAction } from "@/lib/voice-transcribe";

function log(event: string, values: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...values }));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (!safeCompare(secretHeader, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    log("telegram.webhook.unauthorized");
    return new Response("Unauthorized", { status: 401 });
  }

  let updateId: number | null = null;
  let currentChatId: number | null = null;

  try {
    const update = telegramUpdateSchema.parse(await request.json());
    updateId = update.update_id;

    const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
    if (!allowedUserId) {
      throw new Error("TELEGRAM_ALLOWED_USER_ID is missing.");
    }

    const senderId = update.message?.from.id ?? update.callback_query?.from.id;
    if (!senderId || senderId !== allowedUserId) {
      log("telegram.webhook.forbidden", { updateId, senderId });
      return new Response("Forbidden", { status: 403 });
    }

    const alreadyProcessed = await hasProcessedUpdate(updateId);
    if (alreadyProcessed) {
      log("telegram.webhook.duplicate_skipped", {
        updateId,
        durationMs: Date.now() - startedAt,
      });
      return Response.json({ ok: true });
    }

    await markUpdateStarted(updateId);

    // 1. Route Callback Queries
    if (update.callback_query?.data) {
      await dispatchCallback({
        callbackId: update.callback_query.id,
        callbackData: update.callback_query.data,
        userId: update.callback_query.from.id,
        chatId: update.callback_query.message.chat.id,
        messageId: update.callback_query.message.message_id,
        updateId,
        startedAt,
      });
      return Response.json({ ok: true });
    }

    const message = update.message;
    if (!message) {
      await markUpdateCompleted(updateId, "ignored_no_message");
      return Response.json({ ok: true });
    }

    const chatId = message.chat.id;
    currentChatId = chatId;

    // Send typing action immediately for instant visual feedback
    sendTelegramChatAction(chatId, "typing").catch(() => {});

    // 2. Handle Photo & Album Uploads
    if (message.photo?.length) {
      const largestPhoto = message.photo[message.photo.length - 1];
      const photoCaption = message.caption?.trim() ?? "";
      const mediaGroupId = message.media_group_id;

      if (mediaGroupId) {
        cleanupCompletedMediaGroups();

        if (recentlyCompletedMediaGroups.has(mediaGroupId)) {
          await markUpdateCompleted(updateId, "media_group_late_duplicate");
          return Response.json({ ok: true });
        }

        let batch = mediaGroupBatches.get(mediaGroupId);
        const isNewGroup = !batch;

        if (!batch) {
          let resolveDone!: (handled: boolean) => void;
          const donePromise = new Promise<boolean>((resolve) => {
            resolveDone = resolve;
          });

          batch = {
            mediaGroupId,
            chatId,
            userId: message.from.id,
            messageIds: [message.message_id],
            fileIds: [largestPhoto.file_id],
            instruction: photoCaption,
            updateIds: [updateId],
            lastReceivedAt: Date.now(),
            donePromise,
            resolveDone,
          };
          mediaGroupBatches.set(mediaGroupId, batch);
        } else {
          if (!batch.fileIds.includes(largestPhoto.file_id)) {
            batch.fileIds.push(largestPhoto.file_id);
          }
          if (!batch.messageIds.includes(message.message_id)) {
            batch.messageIds.push(message.message_id);
          }
          if (!batch.updateIds.includes(updateId)) {
            batch.updateIds.push(updateId);
          }
          if (!batch.instruction && photoCaption) {
            batch.instruction = photoCaption;
          }
          batch.lastReceivedAt = Date.now();
        }

        if (!isNewGroup) {
          try {
            await batch.donePromise;
          } catch {}
          await markUpdateCompleted(updateId, "media_group_follower");
          return Response.json({ ok: true });
        }

        // Leader waits for sister updates in album
        const MAX_WAIT_MS = 2500;
        const QUIET_PERIOD_MS = 600;
        const waitStart = Date.now();

        while (Date.now() - waitStart < MAX_WAIT_MS) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (Date.now() - batch.lastReceivedAt >= QUIET_PERIOD_MS) {
            break;
          }
        }

        try {
          const handled = await processAssistantImages({
            chatId: batch.chatId,
            userId: batch.userId,
            fileIds: batch.fileIds,
            instruction: batch.instruction,
            updateId,
          });
          recentlyCompletedMediaGroups.set(mediaGroupId, Date.now());
          batch.resolveDone(handled);
        } catch (albumErr) {
          batch.resolveDone(false);
          throw albumErr;
        } finally {
          mediaGroupBatches.delete(mediaGroupId);
        }

        return Response.json({ ok: true });
      }

      // Single photo
      const handled = await processAssistantImages({
        chatId,
        userId: message.from.id,
        fileIds: [largestPhoto.file_id],
        instruction: photoCaption,
        updateId,
      });

      if (handled) {
        return Response.json({ ok: true });
      }
    }

    let text = (message.text || message.caption)?.trim() ?? "";

    // 2.5 Handle Voice Notes & Audio Memos
    if (!text && (message.voice || message.audio)) {
      const audioObj = message.voice || message.audio;
      if (audioObj) {
        try {
          const transcription = await handleVoiceNoteAction({
            chatId,
            fileId: audioObj.file_id,
            mimeType: audioObj.mime_type,
          });

          if (!transcription) {
            await markUpdateCompleted(updateId, "voice_empty");
            return Response.json({ ok: true });
          }

          text = transcription;
        } catch (voiceError) {
          log("telegram.voice_transcribe.failed", {
            updateId,
            error: errorText(voiceError),
          });
          await markUpdateFailed(updateId, errorText(voiceError));
          return Response.json({ ok: true });
        }
      }
    }

    if (!text) {
      await markUpdateCompleted(updateId, "ignored_no_text");
      return Response.json({ ok: true });
    }

    logChatMessage({
      messageId: message.message_id,
      userId: message.from.id,
      role: "user",
      text,
      actionType: message.voice || message.audio ? "voice_transcribed" : "incoming_text",
    }).catch(() => {});


    // 3. Fast-path: Photo Follow-up Instructions
    if (!text.startsWith("/")) {
      let followUpImageFileIds: string[] | undefined;
      let pendingImageToken: string | undefined;

      if (message.reply_to_message?.photo?.length) {
        const replyPhotos = message.reply_to_message.photo;
        followUpImageFileIds = [replyPhotos[replyPhotos.length - 1].file_id];
      } else {
        const pendingImage = await getLatestPendingImage(message.from.id);
        if (pendingImage) {
          const isInstruction =
            /log\s+(this|these)|expense|receipt|screenshot|dates?|calendar|add\s+(this|these)|record|spend/i.test(
              text
            );
          if (isInstruction) {
            followUpImageFileIds = pendingImage.payload.fileIds?.length
              ? pendingImage.payload.fileIds
              : [pendingImage.payload.fileId];
            pendingImageToken = pendingImage.token;
          }
        }
      }

      if (followUpImageFileIds && followUpImageFileIds.length > 0) {
        if (pendingImageToken) {
          await consumePendingImage(pendingImageToken);
        }

        const handled = await processAssistantImages({
          chatId,
          userId: message.from.id,
          fileIds: followUpImageFileIds,
          instruction: text,
          updateId,
        });

        if (handled) {
          return Response.json({ ok: true });
        }
      }

      // Fast-path: Swipe-reply to transaction card to edit
      if (message.reply_to_message) {
        const repliedTxn = await resolveRepliedTransaction(message.reply_to_message);
        if (repliedTxn) {
          const swipeUpdate = parseSwipeReplyTransactionUpdate(text, repliedTxn);
          if (swipeUpdate) {
            const updated = await updateTransaction(repliedTxn.transactionId, swipeUpdate);
            if (updated) {
              await sendTelegramMessage(
                chatId,
                [
                  "✅ *Transaction updated!*",
                  "",
                  `• *Amount:* ${Number(updated.amount).toFixed(2)} ${updated.currency}`,
                  `• *Category:* ${updated.category}`,
                  `• *Description:* ${updated.description}`,
                  `• *Date & Time:* ${updated.timestamp} (SGT)`,
                ].join("\n")
              );
              await markUpdateCompleted(updateId, "finance_modify_swipe_reply_success");
              return Response.json({ ok: true });
            }
          }
        }
      }
    }

    // 4. Route Slash Commands & Shortcuts
    const commandResult = await dispatchCommand({
      chatId,
      userId: message.from.id,
      updateId,
      text,
    });
    if (commandResult.handled) {
      if (commandResult.completionStatus) {
        await markUpdateCompleted(updateId, commandResult.completionStatus);
      }
      return Response.json({ ok: true });
    }

    // 5. Natural Language Intent Classification & Execution
    const messageDateObj = message.date ? new Date(message.date * 1000) : new Date();

    const [recentChatHistory, userCalendarContext, latestTxn, repliedTxn] =
      await Promise.all([
        getRecentChatHistory(message.from.id, 8),
        getLatestUserCalendarContext(message.from.id),
        getLatestTransaction(),
        message.reply_to_message
          ? resolveRepliedTransaction(message.reply_to_message)
          : Promise.resolve(null),
      ]);
    const targetTransaction = repliedTxn || latestTxn;

    const conversationContext: ConversationContext = {
      messageTime: messageDateObj,
      repliedMessageText: message.reply_to_message?.text,
      activePendingCalendar: userCalendarContext.activePending?.payload,
      recentCalendarEvent: userCalendarContext.recentConfirmed,
      recentChatHistory,
      recentTransaction: targetTransaction
        ? {
            transactionId: targetTransaction.transactionId,
            type: targetTransaction.type,
            amount: targetTransaction.amount,
            currency: targetTransaction.currency,
            category: targetTransaction.category,
            description: targetTransaction.description,
            timestamp: targetTransaction.timestamp,
          }
        : undefined,
    };

    const intent = await parseAssistantIntent(text, conversationContext);

    // Dispatch intent to domain handlers
    const dispatched = await defaultRegistry.dispatchIntent(
      {
        chatId,
        userId: message.from.id,
        updateId,
        text,
        messageDateObj,
        userCalendarContext,
        targetTransaction,
      },
      intent
    );

    if (dispatched.handled) {
      if (dispatched.completionStatus) {
        await markUpdateCompleted(updateId, dispatched.completionStatus);
      }
      return Response.json({ ok: true });
    }

    // Fallback search
    if (intent.action === "unknown") {
      const searchRes = await answerWithSearch(text);
      const replyMsg =
        searchRes.source === "fallback"
          ? `${intent.message || searchRes.answer}\n\nType /help or /menu for quick commands.`
          : searchRes.answer;

      await sendTelegramMessage(chatId, replyMsg);
      await markUpdateCompleted(updateId, `search_${searchRes.source}`);
      return Response.json({ ok: true });
    }

    await markUpdateCompleted(updateId, "unhandled_intent");
    return Response.json({ ok: true });
  } catch (error) {
    const message = errorText(error);
    log("telegram.webhook.failed", { updateId, error: message });

    if (updateId !== null) {
      try {
        await markUpdateFailed(updateId, message);
      } catch {}
    }

    if (currentChatId) {
      try {
        await sendTelegramMessage(
          currentChatId,
          "⚠️ Sorry, I ran into an issue processing that. Please try again."
        );
      } catch {}
    }

    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}