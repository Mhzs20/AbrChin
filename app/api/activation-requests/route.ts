import { jsonError, jsonOk, readIdempotencyKey, rejectCrossOrigin } from "@/lib/http";
import {
  getActivationEstimate,
  requestActivation,
} from "@/lib/billing/activation";
import { bigintToString } from "@/lib/money";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCurrentUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const body = (await request.json()) as Record<string, unknown>;
    const quoteId =
      typeof body.quoteId === "string" ? body.quoteId : "";
    const cadence = body.cadence === "DAILY" ? "DAILY" : "HOURLY";
    const activation = await requestActivation({
      quoteId,
      userId: user.id,
      cadence,
      idempotencyKey,
    });
    const estimate = await getActivationEstimate({
      quoteId,
      userId: user.id,
      cadence,
    }).catch(() => null);
    return jsonOk({
      activation: {
        id: activation.id,
        serviceOrderId: activation.serviceOrderId,
        status: activation.status,
        selectedCadence: activation.selectedCadence,
        hourlyEstimateRial: bigintToString(
          activation.estimatedHourlyRial ?? 0n,
        ),
        dailyEstimateRial: bigintToString(
          activation.estimatedDailyRial ?? 0n,
        ),
        minimumCreditRequiredRial: bigintToString(
          activation.minimumCreditRequiredRial,
        ),
        quoteExpiresAt: estimate?.expiresAt.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return jsonError("برای ادامه وارد شوید.", 401);
    }
    if (error instanceof WalletError) {
      const status = [
        "quote_expired",
        "provider_sale_disabled",
        "idempotency_conflict",
      ].includes(error.code)
        ? 409
        : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[activation-request]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("ثبت درخواست فعال‌سازی ممکن نیست.", 500);
  }
}
