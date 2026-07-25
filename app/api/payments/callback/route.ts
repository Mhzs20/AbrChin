import { NextResponse } from "next/server";

/**
 * Legacy single callback removed. Use provider-specific routes:
 * /api/payments/zibal/callback
 * /api/payments/zarinpal/callback
 * /api/payments/mock/callback
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "Gone" }, { status: 410 });
}
