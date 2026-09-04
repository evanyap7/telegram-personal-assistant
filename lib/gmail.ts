import { getGmailClient } from "./google";

export type CreateEmailDraftInput = {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
};

export type EmailDraftResult = {
  draftId: string;
  messageId?: string | null;
  to: string;
  subject: string;
  bodyPreview: string;
  gmailUrl: string;
};

function encodeSubject(subject: string): string {
  // Use RFC 2047 encoding for subjects to ensure emojis and special characters render cleanly
  return `=?utf-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}

function buildRfc2822Message(input: CreateEmailDraftInput): string {
  const headers: string[] = [
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];

  if (input.cc?.trim()) {
    headers.push(`Cc: ${input.cc.trim()}`);
  }

  if (input.bcc?.trim()) {
    headers.push(`Bcc: ${input.bcc.trim()}`);
  }

  return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}

export async function createEmailDraft(
  input: CreateEmailDraftInput
): Promise<EmailDraftResult> {
  const gmail = getGmailClient();
  const rawMessage = buildRfc2822Message(input);
  const base64UrlMessage = Buffer.from(rawMessage, "utf-8").toString(
    "base64url"
  );

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: base64UrlMessage,
      },
    },
  });

  const draftId = res.data.id ?? "";
  const messageId = res.data.message?.id ?? null;

  return {
    draftId,
    messageId,
    to: input.to,
    subject: input.subject,
    bodyPreview:
      input.body.length > 100 ? `${input.body.slice(0, 97)}...` : input.body,
    gmailUrl: "https://mail.google.com/mail/u/0/#drafts",
  };
}
