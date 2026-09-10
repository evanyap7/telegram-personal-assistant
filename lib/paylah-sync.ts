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
import { maskSensitiveFinancialData, SECURITY_SYSTEM_GUARDRAIL } from "./security";

export type EmailTransactionParsedResult = {
  isTransaction: boolean;
  type?: "expense" | "income";
  amount?: number;
  currency?: string;
  merchant?: string;
  item?: string;
  category?: string;
  date?: string;
  referenceNumber?: string;
  paymentMethod?: string;
};

// Backward compatibility alias
export type PayLahParsedResult = EmailTransactionParsedResult;

const VALID_CATEGORIES = [
  "Dining",
  "Transport",
  "Groceries",
  "Shopping",
  "Entertainment",
  "Utilities",
  "Healthcare",
  "Income",
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

function parseEmailTransactionRegex(
  subject: string,
  text: string
): Partial<EmailTransactionParsedResult> | null {
  const sub = subject.toLowerCase();

  // 1. Grab E-Receipt (GrabFood, Grab rides, GrabMart)
  if (
    sub.includes("grab e-receipt") ||
    (sub.includes("e-receipt") && text.includes("Grab"))
  ) {
    const amountMatch = text.match(/TOTAL\s*(?:S\$|SGD)?\s*([0-9]+(?:\.[0-9]{2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    const vehicleTypeMatch = text.match(
      /Vehicle type:\s*(.+?)(?:\s+(?:Issued|Booking|Profile|Receipt|Order from)|$)/i
    );
    const vehicleType = vehicleTypeMatch ? vehicleTypeMatch[1].trim() : "";

    const orderFromMatch = text.match(
      /Order from:\s*(.+?)(?:\s+(?:Delivery|Issued|Profile|Booking|Receipt Summary|Payment Method)|$)/i
    );
    let merchant = orderFromMatch ? orderFromMatch[1].trim() : "";

    // Extract item details if available (e.g. "1x Nasi Lemak with Chicken Cutlet")
    const itemMatch = text.match(
      /Description:\s*Amount:\s*([0-9]+x\s+[^0-9]+?)(?:\s+(?:S\$|SGD)|$)/i
    );
    const item = itemMatch ? itemMatch[1].replace(/\s+/g, " ").trim() : undefined;

    // Date/time: e.g. "Pickup time: 10 Sep 26 16:32 +0800" or "10 Sep 26 16:32"
    const dateMatch = text.match(
      /(?:Pickup time|Order time|Pick-up|Delivered at):\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{2,4}\s+[0-9]{2}:[0-9]{2}(?:\s+[+-][0-9]{4})?)/i
    );
    const rawDate = dateMatch ? dateMatch[1].trim() : undefined;

    let category: Category = "General";
    let paymentMethod = "Grab";

    if (
      vehicleType.toLowerCase().includes("grabfood") ||
      text.includes("GrabFood")
    ) {
      category = "Dining";
      paymentMethod = "GrabFood";
      if (!merchant) merchant = "GrabFood";
    } else if (
      vehicleType.toLowerCase().includes("justgrab") ||
      vehicleType.toLowerCase().includes("grabcar") ||
      vehicleType.toLowerCase().includes("taxi") ||
      vehicleType.toLowerCase().includes("hitch") ||
      vehicleType.toLowerCase().includes("ride")
    ) {
      category = "Transport";
      paymentMethod = "Grab Transport";
      if (!merchant) merchant = "Grab Ride";
    } else if (vehicleType.toLowerCase().includes("grabmart")) {
      category = "Groceries";
      paymentMethod = "GrabMart";
      if (!merchant) merchant = "GrabMart";
    }

    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant: merchant || "Grab",
        item,
        category,
        date: rawDate,
        paymentMethod,
      };
    }
  }

  // 2. GrabPay Wallet Payment (e.g. McDonald's Hanbaobao)
  if (
    sub.includes("you've made a payment to") ||
    (text.includes("Payment method GrabPay") && text.includes("Payment to"))
  ) {
    const amountMatch =
      text.match(/Total\s*(?:S\$|SGD)?\s*([0-9]+(?:\.[0-9]{2})?)/i) ||
      text.match(/Order amount\s*(?:S\$|SGD)?\s*([0-9]+(?:\.[0-9]{2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    let merchant: string | undefined;
    const subjMatch = subject.match(
      /You've made a payment to\s*(.+?)(?:\s*[\u{1F300}-\u{1FAFF}]|\s*🎉|\s*✨|$)/iu
    );
    if (subjMatch) {
      merchant = subjMatch[1].trim();
    } else {
      const toMatch = text.match(
        /Payment to\s+([^\n\r]+?)(?:\s+(?:Payment method|Transaction ID|Rewards|If it was you)|$)/i
      );
      merchant = toMatch ? toMatch[1].trim() : "GrabPay Merchant";
    }

    const refMatch = text.match(/Transaction ID\s*([A-Za-z0-9]+)/i);
    const referenceNumber = refMatch ? refMatch[1].trim() : undefined;

    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant: merchant || "GrabPay Merchant",
        referenceNumber,
        paymentMethod: "GrabPay",
      };
    }
  }

  // 3. Grab Subscription Renewal (GrabUnlimited)
  if (sub.includes("grabunlimited") && sub.includes("renewed")) {
    const amountMatch = text.match(
      /Amount paid\s*(?:SGD|S\$)?\s*([0-9]+(?:\.[0-9]{2})?)/i
    );
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    const dateMatch = text.match(
      /Renewed on\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})/i
    );
    const rawDate = dateMatch ? dateMatch[1].trim() : undefined;

    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant: "GrabUnlimited Subscription",
        category: "Entertainment",
        date: rawDate,
        paymentMethod: "Grab",
      };
    }
  }

  // 4. DBS GIRO deduction
  if (
    sub.includes("successful giro deduction") ||
    text.includes("Successful GIRO deduction")
  ) {
    const amountMatch = text.match(
      /Payment amount:\s*(?:SGD|S\$)?\s*([0-9]+(?:\.[0-9]{2})?)/i
    );
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    const payingToMatch = text.match(
      /Paying to:\s*(.+?)(?:\s+(?:Payment amount|Date & Time|Reference|Yours faithfully)|$)/i
    );
    const merchant = payingToMatch ? payingToMatch[1].trim() : "DBS GIRO Biller";

    const dateMatch = text.match(
      /Date\s*(?:&|and)\s*Time:\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4}(?:\s+[0-9]{2}:[0-9]{2})?)/i
    );
    const rawDate = dateMatch ? dateMatch[1].trim() : undefined;

    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant,
        date: rawDate,
        paymentMethod: "DBS GIRO",
      };
    }
  }

  // 5. DBS Incoming PayNow / Transfer Received (Income)
  if (
    sub.includes("received a transfer") ||
    (text.includes("You have received") && text.includes("via PayNow"))
  ) {
    const amountMatch = text.match(
      /received\s*(?:SGD|S\$)?\s*([0-9]+(?:\.[0-9]{2})?)\s*via PayNow/i
    );
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    const fromMatch = text.match(
      /From:\s*(.+?)(?:\s+(?:To:|Date|Transaction Ref|Account|Yours faithfully)|$)/i
    );
    const sender = fromMatch ? fromMatch[1].trim() : "PayNow Transfer";

    const dateMatch = text.match(
      /Date:\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4}(?:\s+[0-9]{2}:[0-9]{2})?)/i
    );
    const rawDate = dateMatch ? dateMatch[1].trim() : undefined;

    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "income",
        amount,
        currency: "SGD",
        merchant: sender.startsWith("From ") ? sender : `From ${sender}`,
        category: "Income",
        date: rawDate,
        paymentMethod: "DBS PayNow (Incoming)",
      };
    }
  }

  // 6. DBS PayNow / iBanking Outward Transfer
  const ibankingMatch = text.match(
    /PAYNOW TRANSFER of\s*(?:SGD|S\$)?\s*([0-9]+(?:\.[0-9]{2})?)\s*on\s*([0-9/]+)\s*to\s*(.+?)(?:\.|\s+To view|\s+Yours faithfully|$)/i
  );
  if (ibankingMatch) {
    const amount = parseFloat(ibankingMatch[1]);
    const rawDate = ibankingMatch[2];
    const merchant = ibankingMatch[3].trim();
    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant,
        date: rawDate,
        paymentMethod: "DBS PayNow",
      };
    }
  }

  // 7. DBS PayLah! Standard Notification
  const isPayLahAlert =
    text.includes("PayLah!") ||
    text.includes("Scan & Pay") ||
    text.includes("PayNow Transfer") ||
    text.includes("Transaction Ref:");

  if (isPayLahAlert) {
    const amountMatch = text.match(
      /Amount:\s*(?:SGD|USD)?\s*([0-9]+(?:\.[0-9]{2})?)/i
    );
    const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

    const merchantMatch = text.match(
      /To:\s*(.+?)(?:\s+(?:To view|Please call|Yours faithfully|Date & Time|From:)|$)/i
    );
    let merchant = merchantMatch
      ? merchantMatch[1].trim().replace(/[\s,]+$/, "")
      : undefined;

    const refMatch = text.match(/Transaction Ref:\s*([A-Za-z0-9]+)/i);
    const referenceNumber = refMatch ? refMatch[1].trim() : undefined;

    const dateMatch = text.match(
      /Date\s*(?:&|and)\s*Time:\s*([0-9]{1,2}\s+[A-Za-z]{3}(?:\s+[0-9]{2}:[0-9]{2})?)/i
    );
    const rawDate = dateMatch ? dateMatch[1].trim() : undefined;

    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant: merchant || "DBS PayLah Merchant",
        date: rawDate,
        referenceNumber,
        paymentMethod: "DBS PayLah!",
      };
    }
  }

  // 8. DBS Card Alert
  const cardMatch = text.match(
    /(?:transaction of|charged)\s*(?:SGD|S\$)?\s*([0-9]+(?:\.[0-9]{2})?)\s*(?:was made on your DBS Card|on your card).*?at\s*(.+?)(?:\s+on|\.|$)/i
  );
  if (cardMatch) {
    const amount = parseFloat(cardMatch[1]);
    const merchant = cardMatch[2].trim();
    if (amount && amount > 0) {
      return {
        isTransaction: true,
        type: "expense",
        amount,
        currency: "SGD",
        merchant: merchant || "DBS Card Merchant",
        paymentMethod: "DBS Card",
      };
    }
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
    lower.includes("hanbaobao") ||
    lower.includes("wingstop") ||
    lower.includes("mix & match") ||
    lower.includes("grabfood") ||
    lower.includes("koi") ||
    lower.includes("fomo pay") ||
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
    lower.includes("bus") ||
    lower.includes("petrol") ||
    lower.includes("shell") ||
    lower.includes("esso") ||
    lower.includes("spc")
  ) {
    return "Transport";
  }

  if (
    lower.includes("fairprice") ||
    lower.includes("cold storage") ||
    lower.includes("sheng siong") ||
    lower.includes("supermarket") ||
    lower.includes("market") ||
    lower.includes("grabmart") ||
    lower.includes("don don donki") ||
    lower.includes("giant") ||
    lower.includes("redmart")
  ) {
    return "Groceries";
  }

  if (
    lower.includes("singtel") ||
    lower.includes("starhub") ||
    lower.includes("m1") ||
    lower.includes("sp services") ||
    lower.includes("utilities") ||
    lower.includes("senoko") ||
    lower.includes("tuas power") ||
    lower.includes("keppel")
  ) {
    return "Utilities";
  }

  if (
    lower.includes("grabunlimited") ||
    lower.includes("netflix") ||
    lower.includes("spotify") ||
    lower.includes("disney") ||
    lower.includes("steam") ||
    lower.includes("cinema") ||
    lower.includes("theatre")
  ) {
    return "Entertainment";
  }

  if (
    lower.includes("salary") ||
    lower.includes("payroll") ||
    lower.includes("received a transfer") ||
    lower.includes("paynow received")
  ) {
    return "Income";
  }

  try {
    const result = await generateText({
      model: google("gemini-3.6-flash"),
      system: `You are a financial transaction categorizer.
Available categories: Dining, Transport, Groceries, Shopping, Entertainment, Utilities, Healthcare, Income, General.
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

async function parseEmailTransaction(
  subject: string,
  cleanBody: string
): Promise<EmailTransactionParsedResult> {
  // 1. Try deterministic regex first (instant & reliable)
  const regexResult = parseEmailTransactionRegex(subject, cleanBody);
  if (regexResult && regexResult.isTransaction && regexResult.amount) {
    const category =
      regexResult.category ||
      (await inferCategory(regexResult.merchant || "", regexResult.item));

    return {
      isTransaction: true,
      type: regexResult.type || "expense",
      amount: regexResult.amount,
      currency: regexResult.currency || "SGD",
      merchant: regexResult.merchant || "Merchant",
      item: regexResult.item,
      category,
      date: regexResult.date,
      referenceNumber: regexResult.referenceNumber,
      paymentMethod: regexResult.paymentMethod || "DBS / Grab",
    };
  }

  // 2. Fallback to Gemini AI if regex did not match
  try {
    const result = await generateText({
      model: google("gemini-3.6-flash"),
      system: `You are an expert Singapore transaction receipt parser for DBS, POSB, and Grab emails (GrabFood, Grab rides, GrabPay, PayLah, PayNow, GIRO deductions, and Card alerts).
Analyze the email subject and body to determine if this is a completed payment, purchase, deduction, or incoming fund transfer.

Return ONLY one valid JSON object in this format:
{
  "isTransaction": true or false,
  "type": "expense" or "income",
  "amount": positive number,
  "currency": "SGD",
  "merchant": "store, recipient, or sender name (e.g. East Point Mall, Wingstop, Kopitiam, Grab, Alex Tan)",
  "item": "specific item if mentioned (e.g. Chicken Rice, Mix & Match), otherwise null",
  "category": "Dining" | "Transport" | "Groceries" | "Shopping" | "Entertainment" | "Utilities" | "Healthcare" | "Income" | "General",
  "paymentMethod": "GrabFood" | "Grab Transport" | "GrabPay" | "Grab" | "DBS PayLah!" | "DBS PayNow" | "DBS GIRO" | "DBS Card",
  "date": "YYYY-MM-DD or date/time string if mentioned",
  "referenceNumber": "reference number or booking code if mentioned"
}

If this email is merely a marketing promo, meal recommendation, login alert, OTP, or password reset, set "isTransaction": false.

${SECURITY_SYSTEM_GUARDRAIL}`,
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
    console.error("Failed to parse email transaction with AI:", error);
    return { isTransaction: false };
  }
}

function resolveTransactionDate(rawDate?: string): Date {
  if (!rawDate) return new Date();

  // Grab format: "10 Sep 26 16:32 +0800" or native parseable
  const direct = new Date(rawDate);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  // Handle format like "08 Sep 2026 21:05" or "07 Sep 15:13"
  const currentYear = new Date().getFullYear();
  const parsed = new Date(`${rawDate} ${currentYear} +08:00`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
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
    type: string;
    paymentMethod: string;
  }>;
}> {
  const gmail = getGmailClient();

  let targetIds: string[] = [];

  if (options?.messageIds && options.messageIds.length > 0) {
    targetIds = options.messageIds;
  } else {
    // Search both DBS/POSB alerts and Grab receipts within newerThan (default: 1d)
    const newerThan = options?.newerThan || "1d";
    const maxResults = options?.maxResults || 10;
    const query = `(from:(dbs.com OR dbs.com.sg OR posb.com.sg OR grab.com)) (Alert OR Alerts OR Transaction OR Transfer OR deduction OR PayLah OR PayNow OR received OR "E-Receipt" OR "Receipt" OR "payment to" OR "GrabPay" OR "GrabUnlimited") newer_than:${newerThan}`;

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
    type: string;
    paymentMethod: string;
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

      const parsed = await parseEmailTransaction(subjectHeader, cleanBody);

      if (parsed.isTransaction && parsed.amount && parsed.amount > 0) {
        const amount = Math.round(parsed.amount * 100) / 100;
        const merchant = parsed.merchant?.trim() || "Merchant";
        const currency = (parsed.currency || "SGD").toUpperCase();
        const rawCategory = parsed.category || "General";
        const category =
          VALID_CATEGORIES.find(
            (c) => c.toLowerCase() === rawCategory.toLowerCase()
          ) || "General";
        const type = parsed.type === "income" ? "income" : "expense";
        const paymentMethod = parsed.paymentMethod || "Receipt";

        const description =
          type === "income"
            ? `${merchant} (${paymentMethod})`
            : parsed.item
            ? `${parsed.item} @ ${merchant} (${paymentMethod})`
            : `${merchant} (${paymentMethod})`;

        const dateObj = resolveTransactionDate(parsed.date);

        // Add to Google Sheets
        const result = await addTransaction({
          type,
          amount,
          currency,
          category,
          description,
          transactionTimestamp: dateObj,
        });

        // Mark as completed in UpdateLog
        await markExternalIdProcessed(
          externalId,
          `${paymentMethod} ${type}: ${currency} ${amount} at ${merchant} (Txn: ${result.transactionId})`
        );

        loggedCount++;
        loggedItems.push({
          transactionId: result.transactionId,
          amount,
          merchant,
          category,
          type,
          paymentMethod,
        });

        // Send Telegram notification
        const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
        if (allowedUserId) {
          const displayDate = formatSingaporeTimestamp(dateObj);

          // Select dynamic emoji and title
          let cardHeader = "🟣 *DBS Expense Logged!*";
          if (paymentMethod.toLowerCase().includes("grabfood")) {
            cardHeader = "🟢 *GrabFood Expense Logged!*";
          } else if (
            paymentMethod.toLowerCase().includes("grab transport") ||
            paymentMethod.toLowerCase().includes("grab ride")
          ) {
            cardHeader = "🟢 *Grab Ride Logged!*";
          } else if (paymentMethod.toLowerCase().includes("grabpay")) {
            cardHeader = "🟢 *GrabPay Expense Logged!*";
          } else if (paymentMethod.toLowerCase().includes("grab")) {
            cardHeader = "🟢 *Grab Expense Logged!*";
          } else if (type === "income") {
            cardHeader = "💰 *DBS Funds Received!*";
          } else if (paymentMethod.toLowerCase().includes("giro")) {
            cardHeader = "🏛️ *DBS GIRO Deduction Logged!*";
          } else if (paymentMethod.toLowerCase().includes("paylah")) {
            cardHeader = "🟣 *DBS PayLah! Expense Synced!*";
          }

          const messageText = [
            cardHeader,
            "",
            parsed.item ? `• *Item:* ${parsed.item}` : null,
            `• *Amount:* ${type === "income" ? "+" : ""}${currency} ${amount.toFixed(2)}`,
            type === "income" ? `• *Source:* ${merchant}` : `• *Merchant:* ${merchant}`,
            `• *Method:* ${paymentMethod}`,
            `• *Category:* ${category}`,
            `• *Recorded:* ${displayDate}`,
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
            console.error("Failed to send Telegram notification for transaction:", err);
          });
        }
      } else {
        // Only mark non-transaction if not a generic alert
        const isAlert =
          subjectHeader.toLowerCase().includes("transaction alert") ||
          subjectHeader.toLowerCase().includes("receipt");
        if (!isAlert) {
          await markExternalIdProcessed(
            externalId,
            `Non-transaction email: ${subjectHeader.slice(0, 50)}`
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

export const syncEmailTransactions = syncPayLahTransactions;
