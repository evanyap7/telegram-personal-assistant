import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/google";
import { safeCompare } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Verify Vercel Cron authorization or CRON_SECRET if configured
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (cronSecret) {
    const expected = `Bearer ${cronSecret}`;
    if (!authHeader || !safeCompare(authHeader, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    return NextResponse.json(
      {
        ok: false,
        error: "GMAIL_PUBSUB_TOPIC is not set in environment variables.",
      },
      { status: 400 }
    );
  }

  try {
    const gmail = getGmailClient();
    const res = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["INBOX"],
      },
    });

    const expirationMs = res.data.expiration ? Number(res.data.expiration) : null;
    const expiresAt = expirationMs ? new Date(expirationMs).toISOString() : null;

    return NextResponse.json({
      ok: true,
      message: "Gmail push watch renewed successfully.",
      historyId: res.data.historyId,
      expiration: res.data.expiration,
      expiresAt,
    });
  } catch (error: any) {
    console.error("Failed to renew Gmail push notification watch:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to renew Gmail watch",
      },
      { status: 500 }
    );
  }
}
