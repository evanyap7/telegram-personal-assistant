import { parseImageAssistantIntent } from "../image-intent";
import { downloadTelegramPhoto } from "../telegram-files";
import { sendTelegramMessage } from "../telegram";
import {
  addTransaction,
  addTransactionsBatch,
  markUpdateCompleted,
} from "../finance";
import { createCalendarEvent } from "../calendar";
import { formatCalendarDate, formatSingaporeDateTime } from "./calendar-handler";
import {
  addRecurringSchedule,
  computeNextRunDate,
  listRecurringSchedules,
} from "../recurring";
import { registerUndoAction, buildUndoInlineKeyboard } from "../undo";

export interface MediaGroupBatch {
  mediaGroupId: string;
  chatId: number;
  userId: number;
  messageIds: number[];
  fileIds: string[];
  instruction: string;
  updateIds: number[];
  lastReceivedAt: number;
  donePromise: Promise<boolean>;
  resolveDone: (handled: boolean) => void;
}

export const mediaGroupBatches = new Map<string, MediaGroupBatch>();
export const recentlyCompletedMediaGroups = new Map<string, number>();

export function cleanupCompletedMediaGroups() {
  const now = Date.now();
  for (const [id, completedAt] of recentlyCompletedMediaGroups.entries()) {
    if (now - completedAt > 10 * 60 * 1000) {
      recentlyCompletedMediaGroups.delete(id);
    }
  }
}

export async function processAssistantImages(input: {
  chatId: number;
  userId: number;
  fileIds: string[];
  instruction: string;
  updateId: number;
}): Promise<boolean> {
  const { chatId, userId, fileIds, instruction, updateId } = input;
  const imageCount = fileIds.length;

  await sendTelegramMessage(
    chatId,
    imageCount > 1
      ? `📸 Processing your ${imageCount} images...`
      : "📸 Reading your image..."
  );

  let downloadedImages: Array<{ data: Uint8Array; mediaType: string }>;
  try {
    downloadedImages = await Promise.all(
      fileIds.map((fileId) => downloadTelegramPhoto(fileId))
    );
  } catch {
    await sendTelegramMessage(
      chatId,
      "⚠️ Could not download one or more images from Telegram. Please try sending again."
    );
    await markUpdateCompleted(updateId, "image_download_error");
    return true;
  }

  const imageIntent = await parseImageAssistantIntent({
    instruction,
    images: downloadedImages,
  });

  if (imageIntent.action === "unknown") {
    await sendTelegramMessage(
      chatId,
      `${imageIntent.message}\n\nPlease send clearer image(s) or add more detail in your request.`
    );
    await markUpdateCompleted(updateId, "image_unknown");
    return true;
  }

  // Autonomous Single Finance Logging
  if (imageIntent.action === "finance_from_image") {
    const transaction = await addTransaction({
      type: imageIntent.type,
      amount: imageIntent.amount,
      currency: imageIntent.currency,
      category: imageIntent.category,
      description: imageIntent.description,
      explicitDate: imageIntent.transactionDate,
      transactionTimestamp: new Date(),
    });

    const undoToken = await registerUndoAction(userId, {
      type: "finance_transaction_created",
      description: `${imageIntent.description} ($${imageIntent.amount.toFixed(2)} ${imageIntent.currency})`,
      data: { transactionId: transaction.transactionId },
    });

    const lines = [
      "✅ *Expense Logged from Receipt:*",
      `• *Amount:* $${imageIntent.amount.toFixed(2)} ${imageIntent.currency}`,
      `• *Category:* ${imageIntent.category}`,
      `• *Description:* ${imageIntent.description}`,
      `• *Date:* ${imageIntent.transactionDate}`,
    ];

    if (transaction.budgetStatus?.formattedNotice) {
      lines.push("", transaction.budgetStatus.formattedNotice);
    }

    await sendTelegramMessage(
      chatId,
      lines.join("\n"),
      buildUndoInlineKeyboard(undoToken)
    );

    await markUpdateCompleted(updateId, "image_finance_logged");
    return true;
  }

  // Autonomous Batch Finance Logging
  if (imageIntent.action === "finance_batch_from_image") {
    if (!imageIntent.transactions.length) {
      await sendTelegramMessage(chatId, "I could not find any clear transactions in the image(s).");
      await markUpdateCompleted(updateId, "image_finance_empty");
      return true;
    }

    const added = await addTransactionsBatch(
      imageIntent.transactions.map((t) => ({
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        category: t.category,
        description: t.description,
        transactionDate: t.transactionDate,
      }))
    );

    const undoToken = await registerUndoAction(userId, {
      type: "finance_batch_created",
      description: `${added.length} transactions from image`,
      data: { transactionIds: JSON.stringify(added.map((t) => t.transactionId)) },
    });

    const total = imageIntent.transactions.reduce((acc, t) => acc + Number(t.amount), 0);
    const previews = imageIntent.transactions.map((t, idx) => {
      return `${idx + 1}. ${t.description} — $${Number(t.amount).toFixed(2)} ${t.currency} (${t.category})`;
    });

    await sendTelegramMessage(
      chatId,
      [
        `📸 *Processed ${added.length} receipts* (Total: $${total.toFixed(2)}):`,
        "",
        previews.join("\n"),
      ].join("\n"),
      buildUndoInlineKeyboard(undoToken)
    );

    await markUpdateCompleted(updateId, "image_finance_batch_logged");
    return true;
  }

  // Recurring subscriptions from Image
  if (imageIntent.action === "subscriptions_from_image") {
    const sgToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    const existing = await listRecurringSchedules({ type: "subscription" });
    const existingTitles = new Set(existing.map((s) => s.title.trim().toLowerCase()));

    const created: Array<{ id: string; line: string }> = [];
    const skipped: string[] = [];

    for (const sub of imageIntent.subscriptions) {
      const key = sub.title.trim().toLowerCase();
      if (existingTitles.has(key)) {
        skipped.push(sub.title);
        continue;
      }
      existingTitles.add(key);

      const renewal =
        sub.nextRenewalDate && sub.nextRenewalDate >= sgToday ? sub.nextRenewalDate : undefined;
      const dayOfMonth = renewal ? Number(renewal.slice(8, 10)) : undefined;
      const dayOfWeek = renewal ? new Date(`${renewal}T00:00:00Z`).getUTCDay() : undefined;

      const schedule = await addRecurringSchedule({
        type: "subscription",
        title: sub.title,
        amount: sub.amount,
        currency: sub.currency,
        category: sub.category || "Subscriptions",
        frequency: sub.frequency,
        dayOfMonth: sub.frequency === "weekly" ? undefined : dayOfMonth,
        dayOfWeek: sub.frequency === "weekly" ? dayOfWeek : undefined,
        startDate: renewal,
      });

      const next =
        schedule.nextRunDate ||
        computeNextRunDate(sub.frequency, dayOfMonth, dayOfWeek, new Date());
      created.push({
        id: schedule.id,
        line: `${created.length + 1}. ${sub.title} — $${sub.amount.toFixed(2)} ${sub.currency} / ${sub.frequency.replace(/ly$/, "")} (next: ${next})`,
      });
    }

    if (created.length === 0) {
      await sendTelegramMessage(
        chatId,
        `🔁 Those subscriptions are already tracked: ${skipped.join(", ")}.`
      );
      await markUpdateCompleted(updateId, "image_subscriptions_duplicate");
      return true;
    }

    const undoToken = await registerUndoAction(userId, {
      type: "recurring_batch_created",
      description: `${created.length} subscriptions from image`,
      data: { scheduleIds: JSON.stringify(created.map((c) => c.id)) },
    });

    const lines = [
      `🔁 *Added ${created.length} subscription${created.length === 1 ? "" : "s"}:*`,
      "",
      ...created.map((c) => c.line),
      "",
      "They'll be logged automatically on each renewal date.",
    ];
    if (skipped.length > 0) {
      lines.push(`Skipped (already tracked): ${skipped.join(", ")}`);
    }

    await sendTelegramMessage(chatId, lines.join("\n"), buildUndoInlineKeyboard(undoToken));
    await markUpdateCompleted(updateId, "image_subscriptions_added");
    return true;
  }

  // Autonomous Calendar from Image
  if (imageIntent.action === "calendar_from_image") {
    const createdEvents = await Promise.all(
      imageIntent.events.map((ev) =>
        createCalendarEvent({
          calendarName: imageIntent.calendarName,
          ...ev,
        })
      )
    );

    const eventIds = createdEvents.map((e) => e.id).filter(Boolean);

    const undoToken = await registerUndoAction(userId, {
      type: "calendar_batch_created",
      description: `${createdEvents.length} events from image`,
      data: {
        calendarName: imageIntent.calendarName,
        eventIds: JSON.stringify(eventIds),
      },
    });

    const badge = imageIntent.calendarName === "work" ? "💼 Work" : "🏠 Personal";
    const eventPreviews = imageIntent.events.map((ev, idx) => {
      const timing = ev.allDay
        ? `${formatCalendarDate(ev.date || "")} (All day)`
        : `${formatSingaporeDateTime(ev.start || "")} – ${formatSingaporeDateTime(ev.end || "")}`;
      const loc = ev.location ? `\n   📍 ${ev.location}` : "";
      return `${idx + 1}. ${ev.title}\n   📅 ${timing}${loc}`;
    });

    await sendTelegramMessage(
      chatId,
      [
        `📅 *Created ${createdEvents.length} events in ${badge} Calendar:*`,
        "",
        eventPreviews.join("\n\n"),
      ].join("\n"),
      buildUndoInlineKeyboard(undoToken)
    );

    await markUpdateCompleted(updateId, "image_calendar_logged");
    return true;
  }

  return false;
}
