import { AsyncLocalStorage } from "node:async_hooks";
import type { InlineKeyboardMarkup } from "./telegram";

/**
 * A per-request output sink. When set, the Telegram send helpers divert here
 * instead of calling the Telegram API, so the app can reuse every tool/handler.
 */
export interface OutputChannel {
  send(text: string, markup?: InlineKeyboardMarkup): number;
  edit(messageId: number, text: string, markup?: InlineKeyboardMarkup): void;
  removeKeyboard(messageId: number): void;
  answerCallback(text?: string): void;
  document(filename: string, content: string, caption?: string): void;
  action(kind: "typing" | "upload_photo" | "record_voice" | "upload_document"): void;
}

const storage = new AsyncLocalStorage<OutputChannel>();

export function runInChannel<T>(channel: OutputChannel, fn: () => Promise<T>): Promise<T> {
  return storage.run(channel, fn);
}

export function currentChannel(): OutputChannel | undefined {
  return storage.getStore();
}
