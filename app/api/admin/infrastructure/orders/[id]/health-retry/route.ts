import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { isIdempotencyConflictError } from "@/lib/idempotency";
import { scheduleManualHealthRetry } from "@/lib/infrastructure/health-retry-service";
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
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای Retry الزامی است.", 400);
    }
    const meta = await readRequestMeta(request);
    const { id } = await context.params;
    const body: unknown = await request.json();
    const reason =
      typeof body === "object" &&
      body !== null &&
      "reason" in body &&
      typeof (body as { reason: unknown }).reason === "string"
        ? (body as { reason: string }).reason.trim()
        : "";
    const job = await scheduleManualHealthRetry({
      infrastructureOrderId: id,
      adminUserId: admin.id,
      reason,
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk({
      jobId: job.id,
      status: job.status,
      availableAt: job.availableAt.toISOString(),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) {
      return jsonError(adminError.message, adminError.status);
    }
    if (error instanceof WalletError) {
      return jsonError(
        error.message,
        error.code === "idempotency_conflict" ? 409 : 400,
        { code: error.code },
      );
    }
    if (isIdempotencyConflictError(error)) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنه درخواست معتبر نیست.", 400);
    }
    console.error(
      "[admin/health-retry]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("Retry بررسی سلامت ممکن نیست.", 500);
  }
}
