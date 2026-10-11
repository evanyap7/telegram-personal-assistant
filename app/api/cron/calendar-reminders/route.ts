import { NextRequest, NextResponse } from "next/server";
import { checkAndSendEventReminders } from "@/lib/calendar";
import { checkAndSendTodoReminders } from "@/lib/todos";
import { checkAndSendLeaveNowAlerts } from "@/lib/travel";
import { isAuthorizedCronRequest } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [eventResult, todoResult, leaveNowSent] = await Promise.all([
      checkAndSendEventReminders(),
      checkAndSendTodoReminders(),
      checkAndSendLeaveNowAlerts(),
    ]);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      events: eventResult,
      todos: todoResult,
      leaveNowSent,
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
