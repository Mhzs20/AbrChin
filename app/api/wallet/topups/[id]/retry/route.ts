import { PaymentError } from "@/lib/payments/errors";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { retryTopUpPayment } from "@/lib/wallet/topup";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    const { id } = await context.params;
    const result = await retryTopUpPayment({
      userId: user.id,
      topUpId: id,
      idempotencyKey: readIdempotencyKey(request) ?? "",
    });
    return jsonOk({
      topUpId: result.topUp.id,
      attemptId: result.attempt.id,
      redirectUrl: result.redirectUrl,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return jsonError("برای ادامه وارد شوید.", 401);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    if (error instanceof PaymentError) {
      return jsonError("ایجاد تلاش پرداخت جدید ممکن نشد.", 502, {
        code: error.code,
      });
    }
    console.error(
      "[wallet/topups/:id/retry]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("تکرار پرداخت ممکن نیست.", 500);
  }
}
