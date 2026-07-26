import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { refundOrder } from "@/lib/orders/service";
import { AuthRequiredError, readRequestMeta, requireCurrentUser } from "@/lib/session";
import { WalletError } from "@/lib/wallet/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const user = await requireCurrentUser();
    if (user.role !== "ADMIN") {
      return jsonError("دسترسی مجاز نیست.", 403);
    }

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
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({ order: { id: order.id, status: order.status } });
  } catch (error) {
    if (error instanceof AuthRequiredError) return jsonError("برای ادامه وارد شوید.", 401);
    if (error instanceof WalletError) return jsonError(error.message, 400);
    console.error("[orders/refund]", error instanceof Error ? error.message : "unknown");
    return jsonError("بازگشت وجه ممکن نیست.", 500);
  }
}
