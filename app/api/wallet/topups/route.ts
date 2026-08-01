import { jsonError, jsonOk, readIdempotencyKey, rejectCrossOrigin } from "@/lib/http";
import {
  PaymentError,
  resolveDefaultPaymentGateway,
  getPublicDefaultGatewaySummary,
} from "@/lib/payments";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";
import {
  createPurchaseShortfallTopUpIntent,
  createTopUpIntent,
} from "@/lib/wallet/topup";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireCurrentUser();
    const summary = await getPublicDefaultGatewaySummary();
    return jsonOk({
      gatewayAvailable: summary.available,
      gatewayDisplayName: summary.displayName,
      gatewayProvider: summary.provider,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    return jsonOk({ gatewayAvailable: false, gatewayDisplayName: null, gatewayProvider: null });
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const amountToman =
      typeof body === "object" && body && "amountToman" in body
        ? (body as { amountToman: unknown }).amountToman
        : null;
    const orderId =
      typeof body === "object" && body && "orderId" in body &&
      typeof (body as { orderId?: unknown }).orderId === "string"
        ? String((body as { orderId: string }).orderId).trim()
        : "";

    try {
      await resolveDefaultPaymentGateway();
    } catch (error) {
      if (error instanceof PaymentError) {
        return jsonError("درگاه پرداخت موقتاً در دسترس نیست", 503);
      }
      throw error;
    }

    const result = orderId
      ? await createPurchaseShortfallTopUpIntent({
          userId: user.id,
          orderId,
          idempotencyKey:
            readIdempotencyKey(request) ?? "",
        })
      : await createTopUpIntent(user.id, amountToman);
    return jsonOk({
      topUp: {
        id: result.topUp.id,
        status: result.topUp.status,
        amountRial: bigintToString(result.topUp.amount),
        amountToman: bigintToString(rialToToman(result.topUp.amount)),
        amountTomanFa: formatTomanFa(result.topUp.amount),
        gateway: result.topUp.gateway,
        expiresAt: result.topUp.expiresAt.toISOString(),
      },
      redirectUrl: result.redirectUrl,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) {
      return jsonError(
        error.message,
        error.code === "idempotency_conflict" ? 409 : 400,
        { code: error.code },
      );
    }
    if (error instanceof PaymentError) {
      if (error.code === "gateway_unavailable" || error.code === "configuration") {
        return jsonError("درگاه پرداخت موقتاً در دسترس نیست", 503);
      }
      console.error(`[wallet/topups] payment_error code=${error.code}`);
      return jsonError("ایجاد پرداخت ممکن نشد. لطفاً دوباره تلاش کنید.", 502);
    }
    if (error instanceof Error && error.message.includes("positive integer")) {
      return jsonError("مبلغ باید عدد صحیح مثبت به تومان باشد.", 400);
    }
    console.error("[wallet/topups]", error instanceof Error ? error.message : "unknown");
    return jsonError("ایجاد درخواست شارژ ممکن نیست.", 500);
  }
}
