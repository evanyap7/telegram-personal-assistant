import { createCalendarEvent } from "../calendar";
import {
  answerTelegramCallback,
  editTelegramMessage,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
} from "../telegram";
import { fetchBusyIntervals } from "./busy";
import type { GuestDeps } from "./handler";
import { defaultParserRun, parseGuestMessage } from "./intent";
import { createSheetsStore } from "./store";

export type SenderKind = "owner" | "guest" | "none";

export function classifySender(senderId: number | undefined, ownerId: number): SenderKind {
  if (!senderId) return "none";
  return senderId === ownerId ? "owner" : "guest";
}

export function createDefaultGuestDeps(): GuestDeps {
  const ownerId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!ownerId) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID is missing.");
  }
  return {
    store: createSheetsStore(),
    ownerId,
    now: Date.now,
    send: (chatId, text, markup) => sendTelegramMessage(chatId, text, markup, null),
    answerCallback: answerTelegramCallback,
    clearKeyboard: removeTelegramInlineKeyboard,
    edit: (chatId, messageId, text, markup) => editTelegramMessage(chatId, messageId, text, markup, null),
    getBusy: (fromDate, toDate) => fetchBusyIntervals(fromDate, toDate),
    parse: (text, todayDate) => parseGuestMessage(text, todayDate, defaultParserRun),
    createEvent: async ({ title, start, end }) => {
      await createCalendarEvent({ calendarName: "personal", title, start, end });
    },
  };
}
