import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security";
import {
  sendMorningBrief,
  sendEveningRecap,
  sendWeeklyReport,
} from "@/lib/proactive";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let type = searchParams.get("type");

  if (!type) {
    // Infer based on current Singapore time
    const now = new Date();
    const sgHour = Number(
      new Intl.DateTimeFormat("en-SG", {
        timeZone: "Asia/Singapore",
        hour: "numeric",
        hour12: false,
      }).format(now)
    );

    const sgDayOfWeek = new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      weekday: "short",
    }).format(now);

    if (sgHour >= 6 && sgHour < 12) {
      type = "morning";
    } else if (sgDayOfWeek === "Sun" && sgHour >= 18 && sgHour < 22) {
      type = "weekly";
    } else {
      type = "evening";
    }
  }

  try {
    let resultText = "";
    if (type === "morning") {
      resultText = await sendMorningBrief();
    } else if (type === "evening") {
      resultText = await sendEveningRecap();
    } else if (type === "weekly") {
      resultText = await sendWeeklyReport();
    } else {
      return NextResponse.json(
        { ok: false, error: `Invalid briefing type: ${type}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      type,
      sentAt: new Date().toISOString(),
      messageLength: resultText.length,
    });
  } catch (error: unknown) {
    console.error(`Proactive ${type} briefing failed:`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        type,
        error: errMsg || `Failed to send ${type} briefing`,
      },
      { status: 500 }
    );
  }
}
