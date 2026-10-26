import { NextRequest, NextResponse } from "next/server";
import { fireDueRestTimer } from "@/lib/workout/rest-timer";
import { isAuthorizedCronRequest } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await fireDueRestTimer();
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), result });
  } catch (error) {
    console.error("Cron rest timer failed:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
