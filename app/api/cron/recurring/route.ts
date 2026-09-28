import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security";
import { processDueRecurringSchedules } from "@/lib/recurring";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
