import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { markProviderBillingReconciliationForReview } from "@/lib/billing/admin-review";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { isIdempotencyConflictError } from "@/lib/idempotency";
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
    const admin = await requireAdminUser();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      reason?: unknown;
    };
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای عملیات الزامی است.", 400);
    }
    return jsonOk(
      await markProviderBillingReconciliationForReview({
        billingReconciliationId: id,
        actorUserId: admin.id,
        reason: typeof body.reason === "string" ? body.reason : "",
        idempotencyKey,
        ...(await readRequestMeta(request)),
      }),
    );
  } catch (error) {
    const access = adminApiError(error);
    if (access) return jsonError(access.message, access.status);
    if (isIdempotencyConflictError(error)) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    return jsonError("ثبت Review تطبیق ممکن نیست.", 500);
  }
}
