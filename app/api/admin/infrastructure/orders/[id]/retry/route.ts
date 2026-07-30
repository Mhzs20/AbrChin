import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { retryFailedProvisioning } from "@/lib/infrastructure/retry";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
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
    const meta = await readRequestMeta(request);
    const { id } = await context.params;
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // optional body
    }
    const reason =
      typeof body === "object" && body && "reason" in body && typeof (body as { reason: unknown }).reason === "string"
        ? (body as { reason: string }).reason.trim()
        : "";

    const result = await retryFailedProvisioning({
      infrastructureOrderId: id,
      adminUserId: admin.id,
      reason,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({ jobId: result.job.id, status: result.job.status });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof WalletError) return jsonError(error.message, 400);
    if (isIdempotencyConflictError(error)) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    console.error("[admin/retry]", error instanceof Error ? error.message : "unknown");
    return jsonError("Retry ممکن نیست.", 500);
  }
}
