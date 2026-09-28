import { NextRequest, NextResponse } from "next/server";
import { getGmailClient } from "@/lib/google";
import { isAuthorizedCronRequest } from "@/lib/security";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  } catch (error: unknown) {
    console.error("Failed to renew Gmail push notification watch:", error);
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
          "⚠️ *Gmail Watch Renewal Alert*: Google authorization has expired.\n\nPlease re-authorize to keep real-time PayLah tracking active."
        ).catch(() => {});
      }
    }
    return NextResponse.json(
      {
        ok: false,
        error: errMsg || "Failed to renew Gmail watch",
      },
      { status: 500 }
    );
  }
}
