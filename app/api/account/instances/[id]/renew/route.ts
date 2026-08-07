import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  createRenewalQuote,
  payRenewalQuote,
  toPublicRenewalQuote,
} from "@/lib/subscriptions/service";
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

/** Read-only: return the current ACTIVE renewal quote if one exists. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCustomer();
    const { id } = await params;
    const subscription = await prisma.serviceSubscription.findUnique({
      where: { cloudInstanceId: id },
      select: { id: true, userId: true },
    });
    if (!subscription || subscription.userId !== user.id) {
      return jsonError("اشتراک این سرور پیدا نشد.", 404);
    }
    const quote = await prisma.serviceRenewalQuote.findFirst({
      where: {
        subscriptionId: subscription.id,
        userId: user.id,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!quote) {
      return jsonOk({ quote: null });
    }
    return jsonOk({ quote: toPublicRenewalQuote(quote) });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    console.error("[subscription:quote]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت قیمت تمدید ممکن نیست.", 500);
  }
}

/**
 * POST without renewalQuoteId → create/refresh renewal quote (explicit write).
 * POST with renewalQuoteId → pay that quote.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCustomer();
    const { id } = await params;
    let body: { renewalQuoteId?: unknown } = {};
    try {
      body = (await request.json()) as { renewalQuoteId?: unknown };
    } catch {
      body = {};
    }

    if (typeof body.renewalQuoteId === "string" && body.renewalQuoteId) {
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
    }

    const quote = await createRenewalQuote({
      instanceId: id,
      userId: user.id,
    });
    return jsonOk({ quote: toPublicRenewalQuote(quote) });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (error instanceof WalletError) return walletErrorResponse(error);
    console.error("[subscription:renew]", error instanceof Error ? error.message : "unknown");
    return jsonError("تمدید سرور ممکن نیست.", 500);
  }
}
