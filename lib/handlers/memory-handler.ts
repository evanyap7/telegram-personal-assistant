import {
  saveMemory,
  searchMemories,
  formatMemorySearchResult,
  type MemoryCategory,
} from "@/lib/memory";
import { sendTelegramMessage } from "@/lib/telegram";
import { isSecretBoxConfigured } from "@/lib/secret-box";

export async function handleMemorySaveAction(params: {
  chatId: number;
  intent: {
    key: string;
    value: string;
    category?: MemoryCategory;
  };
}): Promise<void> {
  const { chatId, intent } = params;
  try {
    const record = await saveMemory({
      key: intent.key,
      value: intent.value,
      category: intent.category,
    });

    const catBadge =
      record.category === "contact"
        ? "👤"
        : record.category === "credential"
        ? "🔐"
        : record.category === "preference"
        ? "⭐"
        : "🧠";

    const isCredential = record.category === "credential";
    const lines = [
      "✅ *Saved to Memory!*",
      "",
      `${catBadge} *${record.key}*: ${isCredential ? "••••" : record.value}`,
    ];
    if (isCredential && !isSecretBoxConfigured()) {
      lines.push(
        "",
        "⚠️ Stored unencrypted: set `MEMORY_ENCRYPTION_KEY` in your environment to encrypt saved credentials."
      );
    }
    await sendTelegramMessage(chatId, lines.join("\n"));
  } catch (err) {
    console.error("Failed to save memory:", err);
    await sendTelegramMessage(
      chatId,
      "⚠️ Could not save note to Google Sheets memory. Make sure Google Sheets is configured."
    );
  }
}

export async function handleMemoryRecallAction(params: {
  chatId: number;
  intent: {
    query: string;
  };
}): Promise<void> {
  const { chatId, intent } = params;
  try {
    const matches = await searchMemories(intent.query, { limit: 5 });
    const message = formatMemorySearchResult(intent.query, matches);
    await sendTelegramMessage(chatId, message);
  } catch (err) {
    console.error("Failed to recall memory:", err);
    await sendTelegramMessage(
      chatId,
      "⚠️ Could not search memory. Make sure Google Sheets is configured."
    );
  }
}

export async function handleRememberCommand(params: {
  chatId: number;
  text: string;
}): Promise<void> {
  const { chatId, text } = params;
  const raw = text.replace(/^\/remember\s*/i, "").trim();
  if (!raw) {
    await sendTelegramMessage(
      chatId,
      "ℹ️ *Usage*: `/remember <item>: <value>`\nExample: `/remember locker code: 1234`"
    );
    return;
  }

  const colonIdx = raw.indexOf(":");
  let key = raw;
  let value = "";

  if (colonIdx !== -1) {
    key = raw.slice(0, colonIdx).trim();
    value = raw.slice(colonIdx + 1).trim();
  } else {
    const isIdx = raw.toLowerCase().indexOf(" is ");
    if (isIdx !== -1) {
      key = raw.slice(0, isIdx).trim();
      value = raw.slice(isIdx + 4).trim();
    } else {
      value = raw;
    }
  }

  await handleMemorySaveAction({
    chatId,
    intent: {
      key,
      value: value || key,
    },
  });
}

export async function handleRecallCommand(params: {
  chatId: number;
  text: string;
}): Promise<void> {
  const { chatId, text } = params;
  const query = text.replace(/^\/recall\s*/i, "").trim();
  if (!query) {
    await sendTelegramMessage(
      chatId,
      "ℹ️ *Usage*: `/recall <query>`\nExample: `/recall locker code`"
    );
    return;
  }

  await handleMemoryRecallAction({
    chatId,
    intent: {
      query,
    },
  });
}
