import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { payOrderWithWallet } from "@/lib/orders/service";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Wallet-first checkout (Founder flow): the customer tops up via the gateway,
 * returns to the locked quote, reviews the configuration, and submits. This
 * debits the wallet and registers the order without any provisioning; the
 * debit is idempotent via the order_pay_{orderId} ledger key.
 */
export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const result = await payOrderWithWallet(user.id, id);
    return jsonOk({
      order: {
        id: result.order.id,
        status: result.order.status,
        paidAt: result.order.paidAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return jsonError("برای ادامه وارد شوید.", 401);
    }
    if (error instanceof WalletError) {
      const status =
        error.code === "not_found"
          ? 404
          : [
                "quote_price_changed",
                "quote_configuration_changed",
                "quote_expired",
                "quote_unavailable",
                "quote_mismatch",
                "inventory_unavailable",
                "inventory_snapshot_mismatch",
              ].includes(error.code)
            ? 409
            : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[orders/pay-with-wallet]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("پرداخت از کیف پول ممکن نیست.", 500);
  }
}
