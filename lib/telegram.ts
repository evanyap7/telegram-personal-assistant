export type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

export type InlineKeyboardMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

function getTelegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }

  return token;
}

const TELEGRAM_MAX_LENGTH = 4000;

function splitIntoTelegramChunks(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try finding double newline first (paragraph boundary)
    let splitIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength * 0.4) {
      // Try single newline
      splitIdx = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength * 0.4) {
      // Try space
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1) {
      // Hard split
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

async function callTelegram(
  method: string,
  body: Record<string, unknown>,
  attempt = 0
): Promise<any> {
  const token = getTelegramToken();

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const responseText = await response.text();

    // 1. Handle Rate Limit 429
    if (response.status === 429 && attempt < 2) {
      try {
        const json = JSON.parse(responseText);
        const retryAfterSec = json.parameters?.retry_after || 1;
        await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
        return callTelegram(method, body, attempt + 1);
      } catch {
        // Fall through to error
      }
    }

    // 2. Handle Markdown Parse Error -> fallback to plain text if parse_mode was specified
    if (
      (response.status === 400 || response.status === 422) &&
      body.parse_mode &&
      /can't parse entities|entity|format/i.test(responseText)
    ) {
      const { parse_mode, ...bodyWithoutParseMode } = body;
      return callTelegram(method, bodyWithoutParseMode, attempt + 1);
    }

    // 3. Handle editMessage "message is not modified"
    if (
      method === "editMessageText" &&
      /message is not modified/i.test(responseText)
    ) {
      return { ok: true, result: "not_modified" };
    }

    throw new Error(
      `Telegram ${method} failed: ${response.status} ${responseText}`
    );
  }

  try {
    return await response.json();
  } catch {
    return { ok: true };
  }
}

export async function sendTelegramChatAction(
  chatId: number,
  action: "typing" | "upload_photo" | "record_voice" = "typing"
): Promise<void> {
  try {
    await callTelegram("sendChatAction", {
      chat_id: chatId,
      action,
    });
  } catch (err) {
    // Non-fatal, do not throw if chat action fails
    console.warn("Telegram sendChatAction failed:", err);
  }
}

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  parseMode: "Markdown" | "HTML" | null = "Markdown"
): Promise<void> {
  const chunks = splitIntoTelegramChunks(text);

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: parseMode || undefined,
      reply_markup: isLast ? replyMarkup : undefined,
    });
  }
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function removeTelegramInlineKeyboard(
  chatId: number,
  messageId: number
): Promise<void> {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: [],
    },
  });
}

export async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  parseMode: "Markdown" | "HTML" | null = "Markdown"
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: parseMode || undefined,
    reply_markup: replyMarkup,
  });
}

export type BotCommand = {
  command: string;
  description: string;
};

export async function setTelegramBotCommands(
  commands: BotCommand[]
): Promise<void> {
  await callTelegram("setMyCommands", {
    commands,
  });
}