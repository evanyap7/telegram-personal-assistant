import { NextRequest, NextResponse } from "next/server";
import { syncPayLahTransactions } from "@/lib/paylah-sync";

function verifyAuth(req: NextRequest): boolean {
  const secret = process.env.GMAIL_WEBHOOK_SECRET || process.env.APPLE_WALLET_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }
  if (secret && authHeader === `Bearer ${secret}`) {
    return true;
  }

  const queryKey =
    req.nextUrl.searchParams.get("key") ||
    req.nextUrl.searchParams.get("secret");

  if (secret && queryKey === secret) {
    return true;
  }

  const headerKey =
    req.headers.get("x-api-key") ||
    req.headers.get("x-webhook-secret");

  if (secret && headerKey === secret) {
    return true;
  }

  return false;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Missing or invalid secret key." },
      { status: 401 }
    );
  }

  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      // Empty or non-JSON body is acceptable for direct webhook pings
      body = null;
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

    // Process new incoming DBS PayLah receipts
    // Using newerThan: "1d" ensures only newly arrived receipts are evaluated and prevents backfilling history
    const result = await syncPayLahTransactions({
      newerThan: "1d",
      maxResults: 5,
    });

    return NextResponse.json({
      success: true,
      service: "Gmail Real-Time Webhook",
      emailAddress,
      historyId,
      ...result,
    });
  } catch (error) {
    console.error("Gmail webhook error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
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

  const result = await syncPayLahTransactions({
    newerThan: "1d",
    maxResults: 5,
  });

  return NextResponse.json({
    success: true,
    service: "Gmail Real-Time Webhook (Manual Check)",
    ...result,
  });
}
