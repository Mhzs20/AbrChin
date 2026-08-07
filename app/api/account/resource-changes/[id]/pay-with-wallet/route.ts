import { panelApiError, requireCustomer } from "@/lib/auth/guards";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { payUpgradeQuoteWithWallet } from "@/lib/orders/upgrade-quote";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const user = await requireCustomer();
    const meta = await readRequestMeta(request);
    const { id } = await context.params;
    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() || undefined;
    const result = await payUpgradeQuoteWithWallet({
      resourceChangeRequestId: id,
      userId: user.id,
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({
      ok: true,
      reused: result.reused,
      quote: result.view,
      ledgerEntryId: result.ledgerEntryId,
    });
  } catch (error) {
    const panelError = panelApiError(error);
    if (panelError) return jsonError(panelError.message, panelError.status);
    if (error instanceof WalletError) {
      const status =
        error.code === "insufficient_funds"
          ? 402
          : error.code === "quote_expired" ||
              error.code === "target_unavailable"
            ? 409
            : error.code === "not_found"
              ? 404
              : 400;
      return jsonError(error.message, status, { code: error.code });
    }
    console.error(
      "[account/resource-changes/pay-with-wallet]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("پرداخت ارتقا از کیف پول ممکن نیست.", 500);
  }
}
