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
import { parseSingaporeDate } from "./date-parser";

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
    const systemPrompt = `You are a financial transaction categorizer.
Available categories: Dining, Transport, Groceries, Shopping, Entertainment, Utilities, Healthcare, Income, General.
Output ONLY the category name.`;
    const prompt = `Merchant: "${merchant}"\nItem: "${item || "None"}"`;

    let text = "";
    try {
      const result = await generateText({
        model: google("gemini-flash-lite-latest"),
        system: systemPrompt,
        prompt,
      });
      text = result.text;
    } catch {
      const result = await generateText({
        model: google("gemini-3.6-flash"),
        system: systemPrompt,
        prompt,
      });
      text = result.text;
    }

    const matched = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === text.trim().toLowerCase()
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

  // 2. Fallback to Gemini AI if regex did not match (Universal Receipt Parser)
  try {
    const systemPrompt = `You are an expert Singapore transaction receipt and invoice parser.
You parse email receipts, tax invoices, order confirmations, and payment alerts from ANY merchant or platform (e.g. DBS, POSB, Grab, Shopee, Lazada, Amazon, Apple, Foodpanda, Deliveroo, Netflix, Spotify, utilities, telcos, airlines, Stripe, PayPal).

Analyze the email subject and body to determine if this is a completed payment, purchase, deduction, order confirmation with charge, or incoming fund transfer.

CRITICAL ANTI-HALLUCINATION RULES:
- NEVER invent, assume, or hallucinate food items, dish names, products, or subscriptions if they are NOT explicitly printed in the email snippet.
- If specific item names are not explicitly mentioned in the text, set "item": null and use the merchant name verbatim.
- Never guess what was purchased. If only an amount and merchant are provided, "item" MUST be null.
- Do not invent or guess merchants. Use the exact business/sender name from the email.

Return ONLY one valid JSON object in this format:
{
  "isTransaction": true or false,
  "type": "expense" or "income",
  "amount": positive number,
  "currency": "SGD" or 3-letter currency code (default "SGD"),
  "merchant": "store, platform, recipient, or sender name (e.g. Apple, Shopee, Amazon, Wingstop, Grab, SP Services)",
  "item": "specific item if explicitly mentioned in text, otherwise null",
  "category": "Dining" | "Transport" | "Groceries" | "Shopping" | "Entertainment" | "Utilities" | "Healthcare" | "Income" | "General",
  "paymentMethod": "payment channel or merchant name (e.g. Apple Pay, GrabFood, Grab, ShopeePay, DBS Card, DBS PayLah!, Credit Card, Invoice)",
  "date": "YYYY-MM-DD or date/time string if mentioned",
  "referenceNumber": "reference number or booking code if mentioned"
}

If this email is merely a marketing promo, meal recommendation, cart reminder, login alert, OTP, or password reset, set "isTransaction": false.

${SECURITY_SYSTEM_GUARDRAIL}`;

    const prompt = `Email Subject: "${subject}"\nEmail Body/Snippet:\n"""\n${cleanBody.slice(
      0,
      3000
    )}\n"""`;

    let responseText = "";
    try {
      const result = await generateText({
        model: google("gemini-flash-lite-latest"),
        system: systemPrompt,
        prompt,
      });
      responseText = result.text;
    } catch (liteErr) {
      console.warn(
        "gemini-flash-lite-latest failed in parseEmailTransaction, falling back to gemini-3.6-flash:",
        liteErr
      );
      const result = await generateText({
        model: google("gemini-3.6-flash"),
        system: systemPrompt,
        prompt,
      });
      responseText = result.text;
    }

    const cleaned = responseText
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
  return parseSingaporeDate(rawDate);
}

function getNotificationHeader(
  merchant: string,
  paymentMethod: string,
  type: string
): string {
  if (type === "income") return "💰 *Funds Received!*";
  const m = `${merchant} ${paymentMethod}`.toLowerCase();
  if (m.includes("apple")) return "🍎 *Apple Receipt Logged!*";
  if (m.includes("grabfood")) return "🟢 *GrabFood Expense Logged!*";
  if (
    m.includes("grab transport") ||
    m.includes("grab ride") ||
    m.includes("justgrab") ||
    m.includes("grabcar")
  ) {
    return "🟢 *Grab Ride Logged!*";
  }
  if (m.includes("grabpay")) return "🟢 *GrabPay Expense Logged!*";
  if (m.includes("grab")) return "🟢 *Grab Expense Logged!*";
  if (m.includes("shopee")) return "🟠 *Shopee Order Logged!*";
  if (m.includes("lazada")) return "🔵 *Lazada Order Logged!*";
  if (m.includes("amazon")) return "📦 *Amazon Order Logged!*";
  if (m.includes("foodpanda") || m.includes("deliveroo")) {
    return "🍔 *Food Delivery Logged!*";
  }
  if (m.includes("giro")) return "🏛️ *GIRO Deduction Logged!*";
  if (m.includes("paylah")) return "🟣 *DBS PayLah! Expense Synced!*";
  if (m.includes("dbs") || m.includes("posb")) return "🟣 *DBS Expense Logged!*";
  if (
    m.includes("singtel") ||
    m.includes("starhub") ||
    m.includes("m1") ||
    m.includes("sp services") ||
    m.includes("utilities")
  ) {
    return "⚡ *Utility / Bill Logged!*";
  }
  return "🧾 *Receipt Logged!*";
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
    // Search universal receipts, invoices, orders, and bank alerts within newerThan (default: 1d)
    const newerThan = options?.newerThan || "1d";
    const maxResults = options?.maxResults || 10;
    const query = `(subject:(receipt OR "tax invoice" OR "e-receipt" OR "order confirmation" OR "payment received" OR "payment confirmed" OR "your order" OR "bill statement" OR "transaction alert" OR "giro deduction") OR from:(dbs.com OR dbs.com.sg OR posb.com.sg OR grab.com OR shopee.sg OR lazada.sg OR amazon.sg OR apple.com OR foodpanda.sg OR deliveroo.com.sg OR stripe.com OR paypal.com)) newer_than:${newerThan}`;

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

  // Process messages in parallel for sub-second synchronization latency
  const results = await Promise.allSettled(
    targetIds.map(async (messageId) => {
      const externalId = `gmail_${messageId}`;
      const alreadyProcessed = await hasProcessedExternalId(externalId);
      if (alreadyProcessed) {
        return null;
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

          // Send Telegram notification (clean format, no technical IDs shown)
          const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
          if (allowedUserId) {
            const displayDate = formatSingaporeTimestamp(dateObj);
            const cardHeader = getNotificationHeader(merchant, paymentMethod, type);

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

          return {
            transactionId: result.transactionId,
            amount,
            merchant,
            category,
            type,
            paymentMethod,
          };
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
          return null;
        }
      } catch (msgErr) {
        console.error(`Failed to process Gmail message ${messageId}:`, msgErr);
        return null;
      }
    })
  );

  const loggedItems: Array<{
    transactionId: string;
    amount: number;
    merchant: string;
    category: string;
    type: string;
    paymentMethod: string;
  }> = [];

  for (const res of results) {
    if (res.status === "fulfilled" && res.value) {
      loggedItems.push(res.value);
    }
  }

  return {
    scanned: targetIds.length,
    logged: loggedItems.length,
    items: loggedItems,
  };
}

export const syncEmailTransactions = syncPayLahTransactions;
