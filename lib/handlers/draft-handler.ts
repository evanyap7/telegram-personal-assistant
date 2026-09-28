import {
  answerTelegramCallback,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
} from "../telegram";
import {
  cancelPendingEmailDraftAction,
  savePendingEmailDraftAction,
  takePendingEmailDraftAction,
} from "../pending-actions";
import { createEmailDraft } from "../gmail";
import { downloadTelegramAudio } from "../telegram-files";
import { transcribeTelegramVoiceNote } from "../voice-transcribe";
import { markUpdateCompleted, markUpdateFailed } from "../finance";

export function formatEmailDraftPreview(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const parts = [
    "📧 Email Draft Preview:",
    "",
    `👤 To: ${input.to}`,
    `📌 Subject: ${input.subject}`,
  ];
  if (input.cc) parts.push(`👥 Cc: ${input.cc}`);
  if (input.bcc) parts.push(`🔒 Bcc: ${input.bcc}`);
  parts.push("", "📝 Body:", input.body);
  return parts.join("\n");
}

async function removeAndSend(
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  await removeTelegramInlineKeyboard(chatId, messageId);
  await sendTelegramMessage(chatId, text);
}

export async function handleEmailDraftAction(params: {
  chatId: number;
  userId: number;
  intent: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  };
}): Promise<string> {
  const { chatId, userId, intent } = params;

  const token = await savePendingEmailDraftAction({
    userId,
    payload: {
      to: intent.to,
      subject: intent.subject,
      body: intent.body,
      cc: intent.cc,
      bcc: intent.bcc,
    },
  });

  await sendTelegramMessage(
    chatId,
    [
      "Create this draft in your Gmail (evanyap7@gmail.com)?",
      "",
      formatEmailDraftPreview({
        to: intent.to,
        subject: intent.subject,
        body: intent.body,
        cc: intent.cc,
        bcc: intent.bcc,
      }),
    ].join("\n"),
    {
      inline_keyboard: [
        [
          {
            text: "📝 Create Draft in Gmail",
            callback_data: `email_draft_yes:${token}`,
          },
          {
            text: "❌ Cancel",
            callback_data: `email_draft_no:${token}`,
          },
        ],
      ],
    }
  );

  return token;
}

export async function handleEmailDraftCallback(input: {
  callbackId: string;
  action: "email_draft_yes" | "email_draft_no";
  token: string;
  userId: number;
  chatId: number;
  messageId: number;
  updateId: number;
}): Promise<void> {
  if (input.action === "email_draft_no") {
    const cancelled = await cancelPendingEmailDraftAction(
      input.token,
      input.userId
    );

    await answerTelegramCallback(
      input.callbackId,
      cancelled ? "Draft cancelled." : "This request has expired."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      cancelled
        ? "Email draft creation cancelled."
        : "This email draft request has already expired or was handled."
    );

    await markUpdateCompleted(input.updateId, "email_draft_cancelled");
    return;
  }

  const pendingAction = await takePendingEmailDraftAction(
    input.token,
    input.userId
  );

  if (!pendingAction) {
    await answerTelegramCallback(
      input.callbackId,
      "This draft confirmation has expired or was already used."
    );

    await removeAndSend(
      input.chatId,
      input.messageId,
      "This email draft request has expired or was already handled."
    );

    await markUpdateCompleted(
      input.updateId,
      "email_draft_confirmation_invalid"
    );
    return;
  }

  await answerTelegramCallback(input.callbackId, "Creating draft in Gmail...");

  try {
    const draft = await createEmailDraft(pendingAction);

    await removeTelegramInlineKeyboard(input.chatId, input.messageId);

    await sendTelegramMessage(
      input.chatId,
      [
        "✉️ Draft created in Gmail!",
        "",
        `To: ${draft.to}`,
        `Subject: ${draft.subject}`,
        "",
        `🔗 Open Gmail Drafts: ${draft.gmailUrl}`,
      ].join("\n")
    );

    await markUpdateCompleted(input.updateId, "email_draft_created");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await removeAndSend(
      input.chatId,
      input.messageId,
      `Failed to create draft in Gmail: ${errorMessage}`
    );

    await markUpdateFailed(input.updateId, errorMessage);
  }
}

export async function handleVoiceNoteAction(params: {
  chatId: number;
  fileId: string;
  mimeType?: string;
}): Promise<string | null> {
  const { chatId, fileId, mimeType } = params;

  await sendTelegramMessage(chatId, "🎧 Listening to your voice note...");
  try {
    const downloaded = await downloadTelegramAudio(fileId, mimeType);
    const transcription = await transcribeTelegramVoiceNote({
      audio: downloaded.data,
      mediaType: downloaded.mediaType,
    });

    if (!transcription) {
      await sendTelegramMessage(
        chatId,
        "I couldn't hear any words in that voice note. Please try again."
      );
      return null;
    }

    await sendTelegramMessage(chatId, `🎤 Heard: “${transcription}”`);
    return transcription;
  } catch (voiceError) {
    await sendTelegramMessage(
      chatId,
      "Sorry, I had trouble processing that voice note. Please try typing your message."
    );
    throw voiceError;
  }
}
