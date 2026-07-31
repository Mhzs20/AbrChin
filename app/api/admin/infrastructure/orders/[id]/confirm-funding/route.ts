import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { confirmProviderFunding, parseFundedAmountToman } from "@/lib/infrastructure/funding";
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
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("درخواست نامعتبر است.", 400);
    }

    const payload = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    const fundedAmountToman = parseFundedAmountToman(payload.fundedAmountToman);

    const result = await confirmProviderFunding({
      infrastructureOrderId: id,
      adminUserId: admin.id,
      fundedAmountToman,
      receiptReference: typeof payload.receiptReference === "string" ? payload.receiptReference : null,
      note: typeof payload.note === "string" ? payload.note : null,
      idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({
      infrastructureOrderId: result.order.id,
      status: result.order.status,
      jobId: result.job?.id ?? null,
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
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
    console.error("[admin/confirm-funding]", error instanceof Error ? error.message : "unknown");
    return jsonError("تأیید شارژ ممکن نیست.", 500);
  }
}
