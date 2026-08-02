import { jsonError, jsonOk, readIdempotencyKey, rejectCrossOrigin } from "@/lib/http";
import { PaymentError } from "@/lib/payments";
import { createOrderPaymentIntent } from "@/lib/payments/order-payment";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای پرداخت الزامی است.", 400);
    }
    const result = await createOrderPaymentIntent({
      userId: user.id,
      orderId: id,
      idempotencyKey,
    });
    return jsonOk({
      orderPayment: result.payment
        ? {
            id: result.payment.id,
            status: result.payment.status,
            expiresAt: result.payment.expiresAt.toISOString(),
          }
        : null,
      redirectUrl: result.redirectUrl,
      alreadyPaid: result.alreadyPaid,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "payment_review" ||
              error.code === "payment_exists" ||
              error.code === "idempotency_conflict"
            ? 409
            : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    if (error instanceof PaymentError) {
      const status =
        error.code === "gateway_unavailable" || error.code === "configuration"
          ? 503
          : 502;
      return jsonError("درگاه پرداخت موقتاً در دسترس نیست.", status);
    }
    console.error("[orders/payment]", error instanceof Error ? error.message : "unknown");
    return jsonError("ایجاد پرداخت سفارش ممکن نیست.", 500);
  }
}
