import { getGmailClient } from "./google";
import {
  addTransaction,
  formatSingaporeTimestamp,
  hasProcessedExternalId,
  markExternalIdProcessed,
} from "./finance";
import { sendTelegramMessage } from "./telegram";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

type PayLahParsedResult = {
  isPayLahPayment: boolean;
  amount?: number;
  currency?: string;
  merchant?: string;
  item?: string;
  category?: string;
  date?: string;
  referenceNumber?: string;
};

const VALID_CATEGORIES = [
  "Dining",
  "Transport",
  "Groceries",
  "Shopping",
  "Entertainment",
  "Utilities",
  "Healthcare",
  "General",
] as const;

function extractMessageBody(payload: any): string {
  if (!payload) return "";

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        // Strip basic HTML tags
        return html.replace(/<[^>]+>/g, " ");
      }
    }
  }

  return "";
}

async function parsePayLahEmail(
  subject: string,
  bodySnippet: string
): Promise<PayLahParsedResult> {
  try {
    const result = await generateText({
      model: google("gemini-3.6-flash"),
      system: `You are an expert Singapore banking receipt parser for DBS / POSB PayLah! and PayNow emails.
Analyze the email subject and body to determine if this is a completed payment, purchase, or fund transfer made by the user.

Return ONLY one valid JSON object in this format:
{
  "isPayLahPayment": true or false,
  "amount": positive number,
  "currency": "SGD",
  "merchant": "recipient, store, or merchant name (e.g. Kopitiam, Toast Box, Grab, Alex Tan)",
  "item": "specific item if mentioned, otherwise null",
  "category": "Dining" | "Transport" | "Groceries" | "Shopping" | "Entertainment" | "Utilities" | "Healthcare" | "General",
  "date": "YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss+08:00 (if date/time is mentioned in email, otherwise omit)",
  "referenceNumber": "reference number or transaction ID if mentioned"
}

If this email is merely a login notification, marketing promotion, password reset, or failed transaction, set "isPayLahPayment": false.`,
      prompt: `Email Subject: "${subject}"\nEmail Body/Snippet:\n"""\n${bodySnippet.slice(
        0,
        1500
      )}\n"""`,
    });

    const cleaned = result.text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (error) {
    console.error("Failed to parse PayLah email with AI:", error);
    return { isPayLahPayment: false };
  }
}

export async function syncPayLahTransactions(): Promise<{
  scanned: number;
  logged: number;
  items: Array<{
    transactionId: string;
    amount: number;
    merchant: string;
    category: string;
  }>;
}> {
  const gmail = getGmailClient();

  // Query for recent DBS PayLah / PayNow emails
  const query = 'from:(dbs.com) ("PayLah" OR "PayNow") newer_than:7d';

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 10,
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) {
    return { scanned: 0, logged: 0, items: [] };
  }

  let loggedCount = 0;
  const loggedItems: Array<{
    transactionId: string;
    amount: number;
    merchant: string;
    category: string;
  }> = [];

  for (const msg of messages) {
    const messageId = msg.id;
    if (!messageId) continue;

    const externalId = `gmail_${messageId}`;
    const alreadyProcessed = await hasProcessedExternalId(externalId);
    if (alreadyProcessed) {
      continue;
    }

    try {
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const headers = msgRes.data.payload?.headers || [];
      const subjectHeader =
        headers.find((h) => h.name?.toLowerCase() === "subject")?.value || "";
      const bodyContent =
        extractMessageBody(msgRes.data.payload) || msgRes.data.snippet || "";

      const parsed = await parsePayLahEmail(subjectHeader, bodyContent);

      if (parsed.isPayLahPayment && parsed.amount && parsed.amount > 0) {
        const amount = Math.round(parsed.amount * 100) / 100;
        const merchant = parsed.merchant?.trim() || "DBS PayLah Merchant";
        const currency = (parsed.currency || "SGD").toUpperCase();
        const rawCategory = parsed.category || "General";
        const category =
          VALID_CATEGORIES.find(
            (c) => c.toLowerCase() === rawCategory.toLowerCase()
          ) || "General";

        const description = parsed.item
          ? `${parsed.item} @ ${merchant} (DBS PayLah)`
          : `${merchant} (DBS PayLah)`;

        const dateObj = parsed.date ? new Date(parsed.date) : new Date();

        // Add to Google Sheets
        const result = await addTransaction({
          type: "expense",
          amount,
          currency,
          category,
          description,
          transactionTimestamp: dateObj,
        });

        // Mark as completed in UpdateLog
        await markExternalIdProcessed(
          externalId,
          `PayLah expense: ${currency} ${amount} at ${merchant} (Txn: ${result.transactionId})`
        );

        loggedCount++;
        loggedItems.push({
          transactionId: result.transactionId,
          amount,
          merchant,
          category,
        });

        // Send Telegram notification
        const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
        if (allowedUserId) {
          const displayDate = formatSingaporeTimestamp(dateObj);

          const messageText = [
            "🟣 *DBS PayLah! Expense Synced!*",
            "",
            parsed.item ? `• *Item:* ${parsed.item}` : null,
            `• *Amount:* ${currency} ${amount.toFixed(2)}`,
            `• *Merchant:* ${merchant}`,
            `• *Category:* ${category}`,
            `• *Recorded:* ${displayDate}`,
            "",
            `🆔 \`${result.transactionId}\``,
            "",
            "💬 _Tip: Swipe reply to this message anytime to rename the item or modify details!_",
          ]
            .filter(Boolean)
            .join("\n");

          await sendTelegramMessage(allowedUserId, messageText, {
            inline_keyboard: [
              [
                {
                  text: "✏️ Change Category",
                  callback_data: `wallet_cat:${result.transactionId}`,
                },
                {
                  text: "🗑️ Undo / Delete",
                  callback_data: `wallet_undo:${result.transactionId}`,
                },
              ],
            ],
          }).catch((err) => {
            console.error("Failed to send Telegram notification for PayLah:", err);
          });
        }
      } else {
        // Not a payment email (e.g. login alert), mark processed so we don't scan it again
        await markExternalIdProcessed(
          externalId,
          `Non-payment email: ${subjectHeader.slice(0, 50)}`
        );
      }
    } catch (msgErr) {
      console.error(`Failed to process Gmail message ${messageId}:`, msgErr);
    }
  }

  return {
    scanned: messages.length,
    logged: loggedCount,
    items: loggedItems,
  };
}
