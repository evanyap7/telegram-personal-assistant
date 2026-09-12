import { NextRequest, NextResponse } from "next/server";
import { addTransaction, formatSingaporeTimestamp } from "@/lib/finance";
import { sendTelegramMessage } from "@/lib/telegram";
import { safeCompare, maskSensitiveFinancialData } from "@/lib/security";
import { parseSingaporeDate } from "@/lib/date-parser";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

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

function normalizeAmount(val: unknown): number | null {
  if (typeof val === "number" && !Number.isNaN(val) && val > 0) {
    return Math.round(val * 100) / 100;
  }
  if (typeof val === "string") {
    // Strip currency symbols and letters, keeping digits, dot, minus
    const cleaned = val.replace(/[^0-9.-]/g, "");
    const num = parseFloat(cleaned);
    if (!Number.isNaN(num) && num > 0) {
      return Math.round(num * 100) / 100;
    }
  }
  return null;
}

function quickCategorizeMerchant(merchant: string): Category | null {
  const lower = merchant.toLowerCase();

  // Dining
  if (
    lower.includes("starbucks") ||
    lower.includes("mcdonald") ||
    lower.includes("toast box") ||
    lower.includes("yakun") ||
    lower.includes("kfc") ||
    lower.includes("burger") ||
    lower.includes("kopitiam") ||
    lower.includes("food") ||
    lower.includes("cafe") ||
    lower.includes("coffee") ||
    lower.includes("restaurant") ||
    lower.includes("bakery") ||
    lower.includes("breadtalk") ||
    lower.includes("sushi") ||
    lower.includes("ramen") ||
    lower.includes("pizza") ||
    lower.includes("subway") ||
    lower.includes("bbt") ||
    lower.includes("liho") ||
    lower.includes("koi") ||
    lower.includes("chicha") ||
    lower.includes("bar") ||
    lower.includes("bistro") ||
    lower.includes("deliveroo") ||
    lower.includes("foodpanda")
  ) {
    return "Dining";
  }

  // Transport
  if (
    lower.includes("grab") ||
    lower.includes("gojek") ||
    lower.includes("comfort") ||
    lower.includes("tada") ||
    lower.includes("simplygo") ||
    lower.includes("mrt") ||
    lower.includes("transit") ||
    lower.includes("smrt") ||
    lower.includes("sbstransit") ||
    lower.includes("shell") ||
    lower.includes("esso") ||
    lower.includes("caltex") ||
    lower.includes("sp mobility") ||
    lower.includes("parking")
  ) {
    return "Transport";
  }

  // Groceries
  if (
    lower.includes("fairprice") ||
    lower.includes("ntuc") ||
    lower.includes("cold storage") ||
    lower.includes("sheng siong") ||
    lower.includes("giant") ||
    lower.includes("don don donki") ||
    lower.includes("donki") ||
    lower.includes("meidi-ya") ||
    lower.includes("prime supermarket") ||
    lower.includes("redmart") ||
    lower.includes("market")
  ) {
    return "Groceries";
  }

  // Shopping
  if (
    lower.includes("uniqlo") ||
    lower.includes("zara") ||
    lower.includes("apple") ||
    lower.includes("shopee") ||
    lower.includes("lazada") ||
    lower.includes("amazon") ||
    lower.includes("decathlon") ||
    lower.includes("h&m") ||
    lower.includes("ikea") ||
    lower.includes("sephora") ||
    lower.includes("watsons") ||
    lower.includes("guardian") ||
    lower.includes("challenger") ||
    lower.includes("courts") ||
    lower.includes("harvey norman")
  ) {
    return "Shopping";
  }

  // Entertainment
  if (
    lower.includes("cinema") ||
    lower.includes("golden village") ||
    lower.includes("cathay") ||
    lower.includes("shaw") ||
    lower.includes("netflix") ||
    lower.includes("spotify") ||
    lower.includes("steam") ||
    lower.includes("nintendo") ||
    lower.includes("playstation")
  ) {
    return "Entertainment";
  }

  // Utilities
  if (
    lower.includes("singtel") ||
    lower.includes("starhub") ||
    lower.includes("m1") ||
    lower.includes("sp services") ||
    lower.includes("sp group") ||
    lower.includes("utilities") ||
    lower.includes("telecom")
  ) {
    return "Utilities";
  }

  // Healthcare
  if (
    lower.includes("clinic") ||
    lower.includes("hospital") ||
    lower.includes("pharmacy") ||
    lower.includes("dental") ||
    lower.includes("doctor") ||
    lower.includes("medical")
  ) {
    return "Healthcare";
  }

  return null;
}

async function inferCategoryWithAI(
  merchant: string,
  rawCategory?: string,
  item?: string
): Promise<Category> {
  const query = item ? `${item} ${merchant}` : merchant;
  const quick = quickCategorizeMerchant(query);
  if (quick) return quick;

  if (rawCategory) {
    const matched = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === rawCategory.trim().toLowerCase()
    );
    if (matched) return matched;
  }

  try {
    const result = await generateText({
      model: google("gemini-flash-lite-latest"),
      system: `You are a financial transaction categorizer.
Available categories: Dining, Transport, Groceries, Shopping, Entertainment, Utilities, Healthcare, General.
Given a merchant name, optional item purchased, and optional category from Apple Pay, output ONLY the single best category name from the list. Do not add punctuation or explanation.`,
      prompt: `Merchant: "${merchant}"\nItem: "${item || "None"}"\nApple Category: "${rawCategory || "None"}"`,
      maxOutputTokens: 20,
    });

    const output = result.text.trim();
    const matched = VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === output.toLowerCase()
    );
    return matched || "General";
  } catch (error) {
    console.warn("AI categorization failed, falling back to General:", error);
    return "General";
  }
}

function verifyAuth(req: NextRequest, bodySecret?: string): boolean {
  const expectedSecret = process.env.APPLE_WALLET_SECRET;
  if (!expectedSecret) {
    console.error("APPLE_WALLET_SECRET environment variable is not configured.");
    return false;
  }

  // 1. Check body secret if passed by Shortcut
  if (bodySecret && safeCompare(bodySecret, expectedSecret)) {
    return true;
  }

  // 2. Check headers
  const headerKey =
    req.headers.get("x-api-key") ||
    req.headers.get("x-wallet-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (safeCompare(headerKey, expectedSecret)) {
    return true;
  }

  // 3. Check query parameters
  const queryKey =
    req.nextUrl.searchParams.get("key") ||
    req.nextUrl.searchParams.get("secret") ||
    req.nextUrl.searchParams.get("token");

  if (safeCompare(queryKey, expectedSecret)) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  const isAuthed = verifyAuth(req);

  return NextResponse.json({
    status: "ok",
    service: "Telegram Assistant Apple Wallet Webhook",
    authenticated: isAuthed,
    message: isAuthed
      ? "Authentication valid! You can send POST requests with transaction details."
      : "Endpoint ready. Include ?key=<APPLE_WALLET_SECRET> or header x-api-key for authentication.",
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const textBody = await req.text();
    if (textBody && textBody.trim()) {
      body = JSON.parse(textBody);
    }
  } catch {
    // If not JSON, leave body as empty object
  }

  const bodySecret =
    body.secret ? String(body.secret) :
    body.key ? String(body.key) :
    body.token ? String(body.token) : undefined;

  if (!verifyAuth(req, bodySecret)) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Invalid or missing secret key. Pass ?key=<APPLE_WALLET_SECRET> in the URL or 'x-api-key' in headers.",
      },
      { status: 401 }
    );
  }

  // Parse fields passed from iOS Shortcuts flexibly
  const rawAmount =
    body.amount ??
    body.value ??
    body.price ??
    body.total ??
    body["Transaction Amount"] ??
    body["transaction_amount"] ??
    body["TransactionAmount"];
  const amount = normalizeAmount(rawAmount);

  if (!amount) {
    return NextResponse.json(
      {
        error: "Invalid amount",
        message:
          "Could not parse valid positive amount from payload. Provided: " +
          JSON.stringify(rawAmount),
      },
      { status: 400 }
    );
  }

  const rawMerchant =
    body.merchant ??
    body.payee ??
    body.vendor ??
    body.name ??
    body.store ??
    body["Merchant"] ??
    body["Payee"] ??
    body.description ??
    "Apple Pay Purchase";
  const merchant = String(rawMerchant).trim() || "Apple Pay Purchase";

  const rawItem =
    body.item ??
    body.itemName ??
    body.item_name ??
    body.product ??
    body.note ??
    body.notes;
  const itemCandidate = rawItem ? String(rawItem).trim() : undefined;
  const item = itemCandidate && itemCandidate !== merchant ? itemCandidate : undefined;

  const rawCurrency =
    body.currency ??
    body.currencyCode ??
    body["Currency"] ??
    "SGD";
  const currency = String(rawCurrency).trim().toUpperCase() || "SGD";

  const rawCard =
    body.card ??
    body.card_name ??
    body["Card"] ??
    body.paymentMethod ??
    body.account;
  const card = rawCard ? String(rawCard).trim() : undefined;

  const rawCategory =
    body.category ??
    body["Category"];
  const categoryStr = rawCategory ? String(rawCategory).trim() : undefined;

  const rawDate =
    body.date ??
    body["Date"] ??
    body.timestamp ??
    body.time;

  // Safe date resolution (never throws RangeError)
  const dateObj = parseSingaporeDate(rawDate ? String(rawDate) : undefined);

  // Determine category with merchant & item context
  const category = await inferCategoryWithAI(merchant, categoryStr, item);

  // Build description without hallucination
  const description = item
    ? card
      ? `${item} @ ${merchant} (Apple Pay - ${card})`
      : `${item} @ ${merchant} (Apple Pay)`
    : card
    ? `${merchant} (Apple Pay - ${card})`
    : `${merchant} (Apple Pay)`;

  try {
    // 1. Add transaction to Google Sheets
    const result = await addTransaction({
      type: "expense",
      amount,
      currency,
      category,
      description,
      transactionTimestamp: dateObj,
    });

    // 2. Notify User via Telegram
    const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
    if (allowedUserId) {
      const displayDate = formatSingaporeTimestamp(dateObj);

      const messageText = [
        "💳 *Apple Pay Expense Logged!*",
        "",
        item ? `• *Item:* ${item}` : null,
        `• *Amount:* ${currency} ${amount.toFixed(2)}`,
        `• *Merchant:* ${merchant}`,
        `• *Category:* ${category}`,
        card ? `• *Card:* ${card}` : null,
        `• *Recorded:* ${displayDate}`,
        "",
        "💬 _Tip: Swipe reply to this message anytime with what you bought (e.g. \"bought iced latte\") to update it!_",
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
        console.error("Failed to send Telegram notification for Apple Pay:", err);
      });
    }

    return NextResponse.json({
      success: true,
      transactionId: result.transactionId,
      timestamp: result.timestamp,
      amount,
      currency,
      merchant,
      item,
      category,
      description,
    });
  } catch (error) {
    console.error("Failed to record Apple Pay transaction:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
