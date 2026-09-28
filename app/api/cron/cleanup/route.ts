import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/security";
import { pruneExpiredPendingActions } from "@/lib/pending-actions";
import { pruneOldChatHistory } from "@/lib/chat-history";

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

  try {
    const [pendingRes, chatRes] = await Promise.all([
      pruneExpiredPendingActions(24),
      pruneOldChatHistory(30),
    ]);

    return NextResponse.json({
      ok: true,
      cleanedAt: new Date().toISOString(),
      pendingActions: {
        pruned: pendingRes.prunedCount,
        remaining: pendingRes.remainingCount,
      },
      chatHistory: {
        pruned: chatRes.prunedCount,
        remaining: chatRes.remainingCount,
      },
    });
  } catch (error: unknown) {
    console.error("Cleanup cron failed:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: errMsg || "Failed to execute cleanup cron",
      },
      { status: 500 }
    );
  }
}
