import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  adminMarkPaymentDefinitivelyFailed,
  adminReconcileWalletCredit,
  adminReverifyGateway,
  requestControlledTopUpRefund,
} from "@/lib/payments/recovery";
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

type RecoveryAction =
  | "reverify"
  | "reconcile_credit"
  | "mark_failed"
  | "controlled_refund";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const { id: attemptId } = await context.params;
    const idempotencyKey = readIdempotencyKey(request) ?? "";
    const body = (await request.json()) as {
      action?: RecoveryAction;
      reason?: string;
      topUpId?: string;
    };
    const reason = typeof body.reason === "string" ? body.reason : "";

    let result: unknown;
    if (body.action === "reverify") {
      result = await adminReverifyGateway({
        actorUserId: admin.id,
        attemptId,
        idempotencyKey,
        reason,
        ...meta,
      });
    } else if (body.action === "reconcile_credit") {
      result = await adminReconcileWalletCredit({
        actorUserId: admin.id,
        attemptId,
        idempotencyKey,
        reason,
        ...meta,
      });
    } else if (body.action === "mark_failed") {
      result = await adminMarkPaymentDefinitivelyFailed({
        actorUserId: admin.id,
        attemptId,
        idempotencyKey,
        reason,
        ...meta,
      });
    } else if (body.action === "controlled_refund" && body.topUpId) {
      result = await requestControlledTopUpRefund({
        actorUserId: admin.id,
        topUpId: body.topUpId,
        idempotencyKey,
        reason,
        ...meta,
      });
    } else {
      return jsonError("عملیات بازیابی معتبر نیست.", 400);
    }

    return jsonOk({ result });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) {
      return jsonError(adminError.message, adminError.status);
    }
    if (isIdempotencyConflictError(error)) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    console.error(
      "[admin/payment-recovery]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("عملیات بازیابی پرداخت انجام نشد.", 500);
  }
}
