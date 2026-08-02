import { panelApiError, requireAdmin } from "@/lib/auth/guards";
import { jsonError, jsonOk, readIdempotencyKey, rejectCrossOrigin } from "@/lib/http";
import { isIdempotencyConflictError } from "@/lib/idempotency";
import { refundOrder } from "@/lib/orders/service";
import { readRequestMeta } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireAdmin();

    const { id } = await params;
    let reason = "بازگشت وجه توسط ادمین";
    try {
      const body = (await request.json()) as { reason?: string };
      if (typeof body.reason === "string" && body.reason.trim()) reason = body.reason.trim();
    } catch {
      // optional body
    }

    const meta = await readRequestMeta(request);
    const order = await refundOrder({
      orderId: id,
      actorUserId: user.id,
      reason,
      idempotencyKey: readIdempotencyKey(request) ?? "",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({ order: { id: order.id, status: order.status } });
  } catch (error) {
    const accessError = panelApiError(error);
    if (accessError) return jsonError(accessError.message, accessError.status);
    if (isIdempotencyConflictError(error)) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    if (error instanceof WalletError) {
      if (
        error.code === "refund_blocked" ||
        error.code === "idempotency_conflict"
      ) {
        return jsonError(error.message, 409);
      }
      return jsonError(error.message, 400);
    }
    console.error("[orders/refund]", error instanceof Error ? error.message : "unknown");
    return jsonError("بازگشت وجه ممکن نیست.", 500);
  }
}
