import { NextRequest, NextResponse } from "next/server";
import { checkAndSendEventReminders } from "@/lib/calendar";
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

  try {
    const result = await checkAndSendEventReminders();
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("Cron calendar reminders check failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
