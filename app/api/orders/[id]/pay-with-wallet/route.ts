import { jsonError, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Kept as an explicit, safe retirement response for old clients. Customer
 * checkout is gateway-only; internal ledger settlement runs after verification.
 */
export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  return jsonError("پرداخت سفارش فقط از مسیر درگاه انجام می‌شود.", 410);
}
