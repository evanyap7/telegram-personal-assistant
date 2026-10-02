import { NextRequest, NextResponse } from "next/server";
import { syncPayLahTransactions } from "@/lib/paylah-sync";
import { safeCompare } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";

function verifyAuth(req: NextRequest): boolean {
  const secret = process.env.GMAIL_WEBHOOK_SECRET || process.env.APPLE_WALLET_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = req.headers.get("authorization");
  if (cronSecret && safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    return true;
  }
  if (secret && safeCompare(authHeader, `Bearer ${secret}`)) {
    return true;
  }

  const headerKey =
    req.headers.get("x-api-key") ||
    req.headers.get("x-webhook-secret");

  if (secret && safeCompare(headerKey, secret)) {
    return true;
  }

  const queryKey =
    req.nextUrl.searchParams.get("key") ||
    req.nextUrl.searchParams.get("secret");

  if (secret && safeCompare(queryKey, secret)) {
    return true;
  }

  return false;
}

const processedPubSubMessageIds = new Map<string, number>();
const PUBSUB_DEDUPE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEBOUNCE_WINDOW_MS = 2500; // 2.5 seconds debounce for rapid push notification bursts

let activeSyncPromise: Promise<{
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
}> | null = null;
let lastSyncCompletedAt = 0;

function pruneProcessedMessageIds() {
  const now = Date.now();
  for (const [id, ts] of processedPubSubMessageIds.entries()) {
    if (now - ts > PUBSUB_DEDUPE_TTL_MS) {
      processedPubSubMessageIds.delete(id);
    }
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Missing or invalid secret key." },
      { status: 401 }
    );
  }

  try {
    let body: {
      message?: {
        data?: string;
        messageId?: string;
        message_id?: string;
      };
    } | null = null;
    try {
      body = (await req.json()) as {
        message?: {
          data?: string;
          messageId?: string;
          message_id?: string;
        };
      };
    } catch {
      // Empty or non-JSON body is acceptable for direct webhook pings
      body = null;
    }

    // Skip duplicate Pub/Sub delivery retries for identical messageId
    const pubSubMessageId = body?.message?.messageId || body?.message?.message_id;
    if (pubSubMessageId) {
      pruneProcessedMessageIds();
      if (processedPubSubMessageIds.has(pubSubMessageId)) {
        return NextResponse.json({
          success: true,
          service: "Gmail Real-Time Webhook (Duplicate Pub/Sub Message Skipped)",
          skipped: true,
        });
      }
      processedPubSubMessageIds.set(pubSubMessageId, Date.now());
    }

    let emailAddress: string | undefined;
    let historyId: string | undefined;

    // Handle Google Cloud Pub/Sub push notification payload
    if (body?.message?.data) {
      try {
        const decoded = Buffer.from(body.message.data, "base64").toString("utf-8");
        const pubSubJson = JSON.parse(decoded);
        emailAddress = pubSubJson.emailAddress;
        historyId = pubSubJson.historyId;
      } catch (err) {
        console.warn("Could not decode Pub/Sub message data:", err);
      }
    }

    // Coalesce concurrent requests into a single in-flight sync
    if (activeSyncPromise) {
      const result = await activeSyncPromise;
      return NextResponse.json({
        success: true,
        service: "Gmail Real-Time Webhook (Coalesced)",
        emailAddress,
        historyId,
        ...result,
      });
    }

    // Debounce rapid bursts arriving right after a sync just finished
    const timeSinceLastSync = Date.now() - lastSyncCompletedAt;
    if (timeSinceLastSync < DEBOUNCE_WINDOW_MS) {
      return NextResponse.json({
        success: true,
        service: "Gmail Real-Time Webhook (Debounced)",
        emailAddress,
        historyId,
        scanned: 0,
        logged: 0,
        items: [],
      });
    }

    // Process new incoming DBS PayLah receipts and transaction emails
    // Using newerThan: "1d" ensures only newly arrived receipts are evaluated and prevents backfilling history
    activeSyncPromise = syncPayLahTransactions({
      newerThan: "1d",
      maxResults: 5,
    });

    let result;
    try {
      result = await activeSyncPromise;
    } finally {
      activeSyncPromise = null;
      lastSyncCompletedAt = Date.now();
    }

    return NextResponse.json({
      success: true,
      service: "Gmail Real-Time Webhook",
      emailAddress,
      historyId,
      ...result,
    });
  } catch (error) {
    console.error("Gmail webhook error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    if (
      errMsg.includes("invalid_grant") ||
      errMsg.includes("expired") ||
      errMsg.includes("revoked") ||
      errMsg.includes("credentials missing")
    ) {
      const allowedUserId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
      if (allowedUserId) {
        await sendTelegramMessage(
          allowedUserId,
          "⚠️ *Gmail Sync Auth Error*: Google authorization has expired or was revoked.\n\nPayLah & email receipt tracking is currently paused. Please re-authorize to resume automatic tracking."
        ).catch(() => {});
      }
    }
    return NextResponse.json(
      {
        success: false,
        error: "Internal Server Error",
        message: errMsg,
      },
      { status: 200 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Missing or invalid secret key." },
      { status: 401 }
    );
  }

  if (activeSyncPromise) {
    const result = await activeSyncPromise;
    return NextResponse.json({
      success: true,
      service: "Gmail Real-Time Webhook (Manual Check - Coalesced)",
      ...result,
    });
  }

  activeSyncPromise = syncPayLahTransactions({
    newerThan: "1d",
    maxResults: 5,
  });

  let result;
  try {
    result = await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
    lastSyncCompletedAt = Date.now();
  }

  return NextResponse.json({
    success: true,
    service: "Gmail Real-Time Webhook (Manual Check)",
    ...result,
  });
}
