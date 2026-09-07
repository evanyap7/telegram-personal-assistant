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

type Category = (typeof VALID_CATEGORIES)[number];

function extractCleanMessageText(payload: any): string {
  if (!payload) return "";

  function collectText(part: any): string {
    let result = "";
    if (part.body?.data) {
      result += Buffer.from(part.body.data, "base64url").toString("utf-8") + "\n";
    }
    if (part.parts && Array.isArray(part.parts)) {
      for (const p of part.parts) {
        result += collectText(p) + "\n";
      }
    }
    return result;
  }

  let raw = collectText(payload);
  if (!raw.trim()) return "";

  // 1. Remove <style>...</style> blocks and contents
  raw = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  // 2. Remove <script>...</script> blocks and contents
  raw = raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  // 3. Remove all other HTML tags
  raw = raw.replace(/<[^>]+>/g, " ");
  // 4. Decode HTML entities
  raw = raw
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&amp;/g, "&");

  // 5. Normalize whitespace
  return raw.replace(/\s+/g, " ").trim();
}

function parseDbsRegex(text: string): Partial<PayLahParsedResult> | null {
  const isPayLahAlert =
    text.includes("PayLah!") ||
    text.includes("Scan & Pay") ||
    text.includes("PayNow Transfer") ||
    text.includes("Transaction Ref:");

  if (!isPayLahAlert) return null;

  // Amount: e.g. "Amount: SGD8.60" or "Amount: SGD 97.42"
  const amountMatch = text.match(/Amount:\s*(?:SGD|USD)?\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

  // Merchant: e.g. "To: FOMO PAY PTE. LTD. To view" -> "FOMO PAY PTE. LTD."
  const merchantMatch = text.match(/To:\s*(.+?)(?:\s+(?:To view|Please call|Yours faithfully|Date & Time|From:)|$)/i);
  let merchant = merchantMatch ? merchantMatch[1].trim() : undefined;
  if (merchant) {
    // Strip trailing periods or commas
    merchant = merchant.replace(/[\s,]+$/, "");
  }

  // Ref: e.g. "Transaction Ref: IPS78876518592130786"
  const refMatch = text.match(/Transaction Ref:\s*([A-Za-z0-9]+)/i);
  const referenceNumber = refMatch ? refMatch[1].trim() : undefined;

  // Date: e.g. "Date & Time: 07 Sep 15:13 (SGT)"
  const dateMatch = text.match(/Date\s*(?:&|and)\s*Time:\s*([0-9]{1,2}\s+[A-Za-z]{3}(?:\s+[0-9]{2}:[0-9]{2})?)/i);
  const rawDate = dateMatch ? dateMatch[1].trim() : undefined;

  if (amount && amount > 0) {
    return {
      isPayLahPayment: true,
      amount,
      currency: "SGD",
      merchant: merchant || "DBS PayLah Merchant",
      date: rawDate,
      referenceNumber,
    };
  }

  return null;
}

async function inferCategory(merchant: string, item?: string): Promise<Category> {
  const lower = `${merchant} ${item || ""}`.toLowerCase();

  if (
    lower.includes("kopitiam") ||
    lower.includes("food") ||
    lower.includes("cafe") ||
    lower.includes("coffee") ||
    lower.includes("toast box") ||
    lower.includes("yakun") ||
    lower.includes("restaurant") ||
    lower.includes("bakery") ||
    lower.includes("mcdonald") ||
    lower.includes("koi") ||
    lower.includes("fomo pay") || // FOMO Pay is typically hawker / food court QR in Singapore
    lower.includes("bar")
  ) {
    return "Dining";
  }

  if (
    lower.includes("grab") ||
    lower.includes("gojek") ||
    lower.includes("comfort") ||
    lower.includes("simplygo") ||
    lower.includes("transit") ||
    lower.includes("mrt") ||
    lower.includes("bus")
  ) {
    return "Transport";
  }

  if (
    lower.includes("fairprice") ||
    lower.includes("cold storage") ||
    lower.includes("sheng siong") ||
    lower.includes("supermarket") ||
    lower.includes("market")
  ) {
    return "Groceries";
  }

  try {
    const result = await generateText({
      model: google("gemini-3.6-flash"),
      system: `You are a financial transaction categorizer.
Available categories: Dining, Transport, Groceries, Shopping, Entertainment, Utilities, Healthcare, General.
Output ONLY the category name.`,
      prompt: `Merchant: "${merchant}"\nItem: "${item || "None"}"`,
    });
    const matched = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === result.text.trim().toLowerCase()
    );
    return matched || "General";
  } catch {
    return "General";
  }
}

async function parsePayLahEmail(
  subject: string,
  cleanBody: string
): Promise<PayLahParsedResult> {
  // 1. Try deterministic regex first (fast & 100% reliable on DBS alert emails)
  const regexResult = parseDbsRegex(cleanBody);
  if (regexResult && regexResult.isPayLahPayment && regexResult.amount) {
    const category = await inferCategory(regexResult.merchant || "");
    return {
      isPayLahPayment: true,
      amount: regexResult.amount,
      currency: regexResult.currency || "SGD",
      merchant: regexResult.merchant || "DBS PayLah Merchant",
      category,
      date: regexResult.date,
      referenceNumber: regexResult.referenceNumber,
    };
  }

  // 2. Fallback to Gemini AI if regex did not match
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
      prompt: `Email Subject: "${subject}"\nEmail Body/Snippet:\n"""\n${cleanBody.slice(
        0,
        2500
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

function resolveDbsDate(rawDate?: string): Date {
  if (!rawDate) return new Date();

  // Handle format like "07 Sep 15:13" or "07 Sep"
  const currentYear = new Date().getFullYear();
  const parsed = new Date(`${rawDate} ${currentYear} +08:00`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const fallback = new Date(rawDate);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }

  return new Date();
}

export type SyncPayLahOptions = {
  newerThan?: string;
  maxResults?: number;
  messageIds?: string[];
};

export async function syncPayLahTransactions(options?: SyncPayLahOptions): Promise<{
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

  let targetIds: string[] = [];

  if (options?.messageIds && options.messageIds.length > 0) {
    targetIds = options.messageIds;
  } else {
    // Default to only searching the last 1 day to prevent backfilling old receipts
    const newerThan = options?.newerThan || "1d";
    const maxResults = options?.maxResults || 5;
    const query = `from:(dbs.com) ("PayLah" OR "PayNow") newer_than:${newerThan}`;

    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    targetIds = (listRes.data.messages || [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
  }

  if (targetIds.length === 0) {
    return { scanned: 0, logged: 0, items: [] };
  }

  let loggedCount = 0;
  const loggedItems: Array<{
    transactionId: string;
    amount: number;
    merchant: string;
    category: string;
  }> = [];

  for (const messageId of targetIds) {

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
      const cleanBody = extractCleanMessageText(msgRes.data.payload);

      const parsed = await parsePayLahEmail(subjectHeader, cleanBody);

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

        const dateObj = resolveDbsDate(parsed.date);

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
        // Only mark non-payment if not an alert
        if (!subjectHeader.toLowerCase().includes("transaction alert")) {
          await markExternalIdProcessed(
            externalId,
            `Non-payment email: ${subjectHeader.slice(0, 50)}`
          );
        }
      }
    } catch (msgErr) {
      console.error(`Failed to process Gmail message ${messageId}:`, msgErr);
    }
  }

  return {
    scanned: targetIds.length,
    logged: loggedCount,
    items: loggedItems,
  };
}
