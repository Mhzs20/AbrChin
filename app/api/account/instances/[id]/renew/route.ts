import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  createRenewalQuote,
  payRenewalQuote,
  toPublicRenewalQuote,
} from "@/lib/subscriptions/service";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

function walletErrorResponse(error: WalletError) {
  const status =
    error.code === "insufficient_funds"
      ? 402
      : error.code === "quote_price_changed" ||
          error.code === "quote_expired" ||
          error.code === "renewal_unavailable" ||
          error.code === "quote_revalidation_failed"
        ? 409
        : 400;
  return jsonError(error.message, status);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const quote = await createRenewalQuote({
      instanceId: id,
      userId: user.id,
    });
    return jsonOk({ quote: toPublicRenewalQuote(quote) });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) return walletErrorResponse(error);
    console.error("[subscription:quote]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت قیمت تمدید ممکن نیست.", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const body = (await request.json()) as { renewalQuoteId?: unknown };
    if (typeof body.renewalQuoteId !== "string" || !body.renewalQuoteId) {
      return jsonError("ابتدا قیمت تمدید را دریافت و تأیید کنید.", 400);
    }
    const subscription = await payRenewalQuote({
      instanceId: id,
      userId: user.id,
      renewalQuoteId: body.renewalQuoteId,
    });
    return jsonOk({
      subscription: {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        nextRenewalAt: subscription.nextRenewalAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) return walletErrorResponse(error);
    console.error("[subscription:renew]", error instanceof Error ? error.message : "unknown");
    return jsonError("تمدید سرور ممکن نیست.", 500);
  }
}
