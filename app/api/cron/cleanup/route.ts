import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security";
import { pruneExpiredPendingActions } from "@/lib/pending-actions";
import { pruneOldChatHistory } from "@/lib/chat-history";
import { pruneUpdateLog } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Sequential: each prune issues a batchUpdate on the same spreadsheet.
    const pendingRes = await pruneExpiredPendingActions(24);
    const chatRes = await pruneOldChatHistory(30);
    const updateLogRes = await pruneUpdateLog(7);

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
      updateLog: {
        pruned: updateLogRes.prunedCount,
        remaining: updateLogRes.remainingCount,
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
