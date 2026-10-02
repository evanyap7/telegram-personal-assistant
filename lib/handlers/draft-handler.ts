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
import { createEmailDraft, sendGmailDraft } from "../gmail";
import { handleVoiceNoteAction } from "../voice-transcribe";
import { markUpdateCompleted, markUpdateFailed } from "../finance";
import { resolveContact } from "@/lib/memory";

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

  let resolvedTo = intent.to;
  let resolvedCc = intent.cc;
  let resolveNotice = "";

  if (!intent.to.includes("@")) {
    try {
      const contact = await resolveContact(intent.to);
      if (contact?.email) {
        resolvedTo = contact.email;
        resolveNotice = `👤 _Resolved "${intent.to}" ➔ ${contact.name} (${contact.email})_\n\n`;
      }
    } catch (err) {
      console.warn("Contact lookup failed:", err);
    }
  }

  if (intent.cc && !intent.cc.includes("@")) {
    try {
      const contact = await resolveContact(intent.cc);
      if (contact?.email) {
        resolvedCc = contact.email;
      }
    } catch {
      // ignore
    }
  }

  const token = await savePendingEmailDraftAction({
    userId,
    payload: {
      to: resolvedTo,
      subject: intent.subject,
      body: intent.body,
      cc: resolvedCc,
      bcc: intent.bcc,
    },
  });

  await sendTelegramMessage(
    chatId,
    [
      `${resolveNotice}Create this draft in your Gmail (evanyap7@gmail.com)?`,
      "",
      formatEmailDraftPreview({
        to: resolvedTo,
        subject: intent.subject,
        body: intent.body,
        cc: resolvedCc,
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
      ].join("\n"),
      {
        inline_keyboard: [
          [
            {
              text: "📤 Send Now",
              callback_data: `email_send:${draft.draftId}`,
            },
          ],
        ],
      }
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

export async function handleEmailSendCallback(params: {
  callbackId: string;
  callbackData: string;
  chatId: number;
  messageId: number;
}): Promise<boolean> {
  const { callbackId, callbackData, chatId, messageId } = params;
  const parts = callbackData.split(":");
  const draftId = parts[1];

  if (!draftId) {
    await answerTelegramCallback(callbackId, "Invalid draft ID.");
    return true;
  }

  await answerTelegramCallback(callbackId, "Sending email via Gmail...");
  const result = await sendGmailDraft(draftId);

  if (result.success) {
    await removeTelegramInlineKeyboard(chatId, messageId);
    await sendTelegramMessage(
      chatId,
      "🚀 *Email Sent!* Your message has been sent via Gmail."
    );
    return true;
  } else {
    await sendTelegramMessage(
      chatId,
      `⚠️ Could not send draft: ${result.error || "Unknown error"}. You can still send it manually from Gmail.`
    );
    return true;
  }
}

export { handleVoiceNoteAction };

