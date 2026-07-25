import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { bigintToString, formatTomanFa, rialToToman } from "@/lib/money";
import { payOrderWithWallet } from "@/lib/orders/service";
import { AuthRequiredError, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/ledger";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    const { id } = await params;
    const order = await payOrderWithWallet(user.id, id);
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
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) {
      const status = error.code === "insufficient_funds" ? 402 : 400;
      return jsonError(error.message, status);
    }
    console.error("[orders/pay]", error instanceof Error ? error.message : "unknown");
    return jsonError("پرداخت سفارش ممکن نیست.", 500);
  }
}
