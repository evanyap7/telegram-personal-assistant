import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/security";
import { processDueRecurringSchedules } from "@/lib/recurring";

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
    const result = await processDueRecurringSchedules();

    return NextResponse.json({
      ok: true,
      processedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error: unknown) {
    console.error("Recurring schedules cron failed:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        error: errMsg || "Failed to process recurring schedules",
      },
      { status: 500 }
    );
  }
}
