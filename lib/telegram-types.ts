import { z } from "zod";
import { InlineKeyboardMarkup } from "./telegram";
import { AssistantIntent } from "./assistant-intent";

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      date: z.number().optional(),
      chat: z.object({
        id: z.number(),
      }),
      from: z.object({
        id: z.number(),
      }),
      text: z.string().optional(),
      caption: z.string().optional(),
      media_group_id: z.string().optional(),
      reply_to_message: z
        .object({
          message_id: z.number(),
          date: z.number().optional(),
          media_group_id: z.string().optional(),
          text: z.string().optional(),
          photo: z
            .array(
              z.object({
                file_id: z.string(),
                file_unique_id: z.string(),
                width: z.number(),
                height: z.number(),
                file_size: z.number().optional(),
              })
            )
            .optional(),
        })
        .optional(),
      photo: z
        .array(
          z.object({
            file_id: z.string(),
            file_unique_id: z.string(),
            width: z.number(),
            height: z.number(),
            file_size: z.number().optional(),
          })
        )
        .optional(),
      voice: z
        .object({
          file_id: z.string(),
          file_unique_id: z.string(),
          duration: z.number().optional(),
          mime_type: z.string().optional(),
          file_size: z.number().optional(),
        })
        .optional(),
      audio: z
        .object({
          file_id: z.string(),
          file_unique_id: z.string(),
          duration: z.number().optional(),
          mime_type: z.string().optional(),
          file_size: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: z.object({
        id: z.number(),
      }),
      data: z.string().optional(),
      message: z.object({
        message_id: z.number(),
        date: z.number().optional(),
        chat: z.object({
          id: z.number(),
        }),
      }),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface TelegramRequestContext {
  chatId: number;
  userId: number;
  messageId: number;
  text?: string;
  caption?: string;
  isVoiceOrAudio?: boolean;
  voiceFileId?: string;
  photoFileId?: string;
  replyToMessage?: TelegramUpdate["message"] extends { reply_to_message?: infer R } ? R : unknown;
}

export interface IntentHandlerResponse {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
  parseMode?: "Markdown" | "HTML";
}

export interface IntentHandler<TIntent = AssistantIntent> {
  action: string;
  handle(ctx: TelegramRequestContext, intent: TIntent): Promise<IntentHandlerResponse | void>;
}

export interface CallbackHandler {
  prefix: string;
  handle(
    chatId: number,
    userId: number,
    messageId: number,
    callbackQueryId: string,
    data: string
  ): Promise<void>;
}
