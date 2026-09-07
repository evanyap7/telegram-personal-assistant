import { NextRequest, NextResponse } from "next/server";
import { syncPayLahTransactions } from "@/lib/paylah-sync";

function verifyAuth(req: NextRequest): boolean {
  const secret = process.env.APPLE_WALLET_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const queryKey =
    req.nextUrl.searchParams.get("key") ||
    req.nextUrl.searchParams.get("secret");

  if (secret && queryKey === secret) {
    return true;
  }

  const headerKey =
    req.headers.get("x-api-key") ||
    req.headers.get("x-wallet-secret");

  if (secret && headerKey === secret) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Missing or invalid secret key." },
      { status: 401 }
    );
  }

  try {
    const result = await syncPayLahTransactions();
    return NextResponse.json({
      success: true,
      service: "DBS PayLah Gmail Sync",
      ...result,
    });
  } catch (error) {
    console.error("PayLah sync error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
