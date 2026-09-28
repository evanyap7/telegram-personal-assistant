import {
  addRecurringSchedule,
  listRecurringSchedules,
  toggleRecurringSchedule,
  type AddRecurringInput,
  type RecurringFrequency,
  type RecurringSchedule,
} from "@/lib/recurring";
import {
  sendTelegramMessage,
  answerTelegramCallback,
  removeTelegramInlineKeyboard,
  type InlineKeyboardMarkup,
} from "@/lib/telegram";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeCadence(schedule: {
  frequency: RecurringFrequency;
  dayOfMonth?: number;
  dayOfWeek?: number;
}): string {
  if (schedule.frequency === "weekly" && schedule.dayOfWeek !== undefined) {
    return `every ${WEEKDAYS[schedule.dayOfWeek] ?? "week"}`;
  }
  if (schedule.frequency === "monthly" && schedule.dayOfMonth !== undefined) {
    return `monthly on day ${schedule.dayOfMonth}`;
  }
  return schedule.frequency;
}

function formatScheduleLine(schedule: RecurringSchedule): string {
  const icon = schedule.type === "subscription" ? "💳" : "📝";
  const amount =
    schedule.type === "subscription" && schedule.amount
      ? ` — $${schedule.amount.toFixed(2)} ${schedule.currency || "SGD"}`
      : "";
  const status = schedule.active ? `next ${schedule.nextRunDate}` : "⏸️ paused";
  return `${icon} *${schedule.title}*${amount}\n   🔁 ${describeCadence(schedule)} · ${status}`;
}

export async function handleRecurringAddAction(params: {
  chatId: number;
  intent: AddRecurringInput;
}): Promise<void> {
  const { chatId, intent } = params;

  if (intent.type === "subscription" && !intent.amount) {
    await sendTelegramMessage(
      chatId,
      "How much is this subscription? e.g. “Spotify $11.98 every month”."
    );
    return;
  }

  try {
    const schedule = await addRecurringSchedule(intent);
    await sendTelegramMessage(
      chatId,
      [
        "🔁 *Recurring schedule created!*",
        "",
        formatScheduleLine(schedule),
        "",
        schedule.type === "subscription"
          ? "I'll log this expense automatically on each run date."
          : "I'll add this to your to-do list on each run date.",
      ].join("\n"),
      {
        inline_keyboard: [
          [
            {
              text: "⏸️ Pause",
              callback_data: `recurring_toggle:off:${schedule.id}`,
            },
            { text: "🔁 All Recurring", callback_data: "menu:recurring" },
          ],
        ],
      }
    );
  } catch (err) {
    console.error("Failed to add recurring schedule:", err);
    await sendTelegramMessage(
      chatId,
      "⚠️ Could not save the recurring schedule to Google Sheets."
    );
  }
}

export async function buildRecurringListMessage(): Promise<{
  text: string;
  replyMarkup: InlineKeyboardMarkup;
}> {
  const schedules = await listRecurringSchedules();

  if (schedules.length === 0) {
    return {
      text: [
        "🔁 *Recurring Schedules*",
        "",
        "You have no recurring subscriptions or tasks yet.",
        "",
        "Try saying:",
        "• “Spotify $11.98 every month”",
        "• “Remind me to pay rent on the 1st every month”",
        "• `/recurring add monthly 1 Pay rent`",
      ].join("\n"),
      replyMarkup: { inline_keyboard: [] },
    };
  }

  const buttons = schedules.slice(0, 20).map((s) => [
    {
      text: `${s.active ? "⏸️ Pause" : "▶️ Resume"}: ${s.title}`.slice(0, 58),
      callback_data: `recurring_toggle:${s.active ? "off" : "on"}:${s.id}`,
    },
  ]);

  return {
    text: ["🔁 *Recurring Schedules*", "", ...schedules.map(formatScheduleLine)].join(
      "\n\n"
    ),
    replyMarkup: { inline_keyboard: buttons },
  };
}

export async function handleRecurringViewAction(params: {
  chatId: number;
}): Promise<void> {
  const { text, replyMarkup } = await buildRecurringListMessage();
  await sendTelegramMessage(
    params.chatId,
    text,
    replyMarkup.inline_keyboard.length > 0 ? replyMarkup : undefined
  );
}

export async function handleRecurringToggleCallback(params: {
  callbackId: string;
  callbackData: string;
  chatId: number;
  messageId: number;
}): Promise<boolean> {
  const [, mode, id] = params.callbackData.split(":");
  if (!id || (mode !== "on" && mode !== "off")) {
    await answerTelegramCallback(params.callbackId, "Invalid recurring action.");
    return true;
  }

  const ok = await toggleRecurringSchedule(id, mode === "on");
  if (!ok) {
    await answerTelegramCallback(params.callbackId, "Schedule not found.");
    return true;
  }

  await answerTelegramCallback(
    params.callbackId,
    mode === "on" ? "Schedule resumed!" : "Schedule paused!"
  );
  await removeTelegramInlineKeyboard(params.chatId, params.messageId);
  await handleRecurringViewAction({ chatId: params.chatId });
  return true;
}

const COMMAND_USAGE = [
  "ℹ️ *Recurring usage*",
  "",
  "• `/recurring` — list schedules",
  "• `/recurring add monthly 1 Pay rent` — task on the 1st of every month",
  "• `/recurring add weekly mon Gym laundry` — task every Monday",
  "• `/recurring sub monthly 5 Spotify 11.98` — subscription expense on the 5th",
].join("\n");

function parseDayArg(
  frequency: RecurringFrequency,
  token: string | undefined
): { dayOfMonth?: number; dayOfWeek?: number; consumed: boolean } {
  if (!token) return { consumed: false };
  if (frequency === "weekly") {
    const idx = WEEKDAYS.findIndex((d) => token.toLowerCase().startsWith(d.toLowerCase()));
    return idx >= 0 ? { dayOfWeek: idx, consumed: true } : { consumed: false };
  }
  if (frequency === "monthly" || frequency === "yearly") {
    const n = Number(token);
    return Number.isInteger(n) && n >= 1 && n <= 31
      ? { dayOfMonth: n, consumed: true }
      : { consumed: false };
  }
  return { consumed: false };
}

/**
 * /recurring                                   -> list
 * /recurring add <freq> [day] <task title>     -> recurring task
 * /recurring sub <freq> [day] <title> <amount> -> subscription expense
 */
export async function handleRecurringCommand(params: {
  chatId: number;
  text: string;
}): Promise<void> {
  const { chatId } = params;
  const args = params.text.replace(/^\/recurring\s*/i, "").trim().split(/\s+/).filter(Boolean);

  if (args.length === 0) {
    await handleRecurringViewAction({ chatId });
    return;
  }

  const [sub, freqRaw, ...rest] = args;
  const frequency = (freqRaw || "").toLowerCase() as RecurringFrequency;
  if (
    !["add", "sub"].includes(sub.toLowerCase()) ||
    !["daily", "weekly", "monthly", "yearly"].includes(frequency)
  ) {
    await sendTelegramMessage(chatId, COMMAND_USAGE);
    return;
  }

  const day = parseDayArg(frequency, rest[0]);
  const remaining = day.consumed ? rest.slice(1) : rest;

  if (sub.toLowerCase() === "sub") {
    const amount = Number(remaining[remaining.length - 1]?.replace(/^\$/, ""));
    const title = remaining.slice(0, -1).join(" ");
    if (!title || !Number.isFinite(amount) || amount <= 0) {
      await sendTelegramMessage(chatId, COMMAND_USAGE);
      return;
    }
    await handleRecurringAddAction({
      chatId,
      intent: {
        type: "subscription",
        title,
        amount,
        frequency,
        dayOfMonth: day.dayOfMonth,
        dayOfWeek: day.dayOfWeek,
      },
    });
    return;
  }

  const title = remaining.join(" ");
  if (!title) {
    await sendTelegramMessage(chatId, COMMAND_USAGE);
    return;
  }
  await handleRecurringAddAction({
    chatId,
    intent: {
      type: "recurring_task",
      title,
      frequency,
      dayOfMonth: day.dayOfMonth,
      dayOfWeek: day.dayOfWeek,
    },
  });
}
