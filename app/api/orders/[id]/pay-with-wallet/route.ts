import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";
import { payOrderWithWallet } from "@/lib/orders/service";
import { refreshRecommendationQuote } from "@/lib/recommendation/quote-service";
import { prisma } from "@/lib/db";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  let authenticatedUserId = "";
  let orderId = "";
  try {
    const user = await requireCurrentUser();
    authenticatedUserId = user.id;
    const { id } = await params;
    orderId = id;
    const result = await payOrderWithWallet(user.id, id);
    const order = result.order;
    return jsonOk({
      order: {
        id: order.id,
        title: order.title,
        status: order.status,
        amountTomanFa: formatTomanFa(order.amount),
        amountRial: bigintToString(order.amount),
        amountToman: bigintToString(rialToToman(order.amount)),
        paidAt: order.paidAt?.toISOString() ?? null,
      },
      infrastructureOrder: result.infrastructureOrder
        ? {
            id: result.infrastructureOrder.id,
            status: result.infrastructureOrder.status,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) {
      const status =
        error.code === "insufficient_funds"
          ? 402
          : error.code === "quote_price_changed" ||
              error.code === "quote_configuration_changed" ||
              error.code === "quote_expired" ||
              error.code === "quote_unavailable" ||
              error.code === "quote_revalidation_failed" ||
              error.code === "provider_sale_disabled" ||
              error.code === "provider_provisioning_not_enabled"
            ? 409
            : 400;
      if (
        (error.code === "quote_price_changed" ||
          error.code === "quote_configuration_changed") &&
        authenticatedUserId &&
        orderId
      ) {
        const order = await prisma.serviceOrder.findFirst({
          where: { id: orderId, userId: authenticatedUserId },
          select: { recommendationQuoteId: true },
        });
        const replacementQuote = order?.recommendationQuoteId
          ? await refreshRecommendationQuote({
              quoteId: order.recommendationQuoteId,
              userId: authenticatedUserId,
            })
          : null;
        return jsonError(error.message, status, { replacementQuote });
      }
      return jsonError(error.message, status);
    }
    console.error("[orders/pay]", error instanceof Error ? error.message : "unknown");
    return jsonError("پرداخت سفارش ممکن نیست.", 500);
  }
}
