import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";
import { getUpgradeQuoteForCustomer } from "@/lib/orders/upgrade-quote";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireCustomer();
    const { id } = await context.params;
    const quote = await getUpgradeQuoteForCustomer({
      resourceChangeRequestId: id,
      userId: user.id,
    });
    return jsonOk({ quote });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    if (error instanceof WalletError) {
      const status = error.code === "not_found" ? 404 : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[account/resource-changes:get]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("بارگذاری پیش‌فاکتور ارتقا ممکن نیست.", 500);
  }
}
