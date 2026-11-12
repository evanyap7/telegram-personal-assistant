import type { InputMode } from "@/lib/agent/input-mode";
import type { TelegramUpdate } from "@/lib/telegram-types";

// Kept free of runtime imports so the app runner and offline tests can load it
// without pulling in the whole EGO pipeline. Re-exported from ego-pipeline.ts.

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

/** One EGO turn, independent of the surface (Telegram webhook or the app) it came from. */
export interface EgoTurn {
  chatId: number;
  userId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
  date: Date;
  replyTo?: TelegramMessage["reply_to_message"];
}

/** Maps a Telegram message onto the neutral turn shape. */
export function egoTurnFromMessage(params: {
  message: TelegramMessage;
  chatId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
}): EgoTurn {
  const { message, chatId, updateId, text, inputMode } = params;
  return {
    chatId,
    userId: message.from.id,
    updateId,
    text,
    inputMode,
    date: message.date ? new Date(message.date * 1000) : new Date(),
    replyTo: message.reply_to_message,
  };
}
