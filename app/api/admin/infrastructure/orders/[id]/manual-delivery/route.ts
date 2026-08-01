import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, readIdempotencyKey, rejectCrossOrigin } from "@/lib/http";
import { isIdempotencyConflictError } from "@/lib/idempotency";
import { completeManualReadyDelivery } from "@/lib/infrastructure/manual-ready-delivery";
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
      return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    }
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const meta = await readRequestMeta(request);
    const result = await completeManualReadyDelivery({
      infrastructureOrderId: id,
      adminUserId: admin.id,
      providerResourceId:
        typeof body.providerResourceId === "string" ? body.providerResourceId : "",
      ipv4: typeof body.ipv4 === "string" ? body.ipv4 : "",
      username: typeof body.username === "string" ? body.username : "",
      secret: typeof body.secret === "string" ? body.secret : "",
      reason: typeof body.reason === "string" ? body.reason : "",
      idempotencyKey,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk(result);
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
        code: "idempotency_conflict",
      });
    }
    console.error("[admin/manual-ready-delivery]", error instanceof Error ? error.message : "unknown");
    return jsonError("ثبت تحویل دستی ممکن نیست.", 500);
  }
}
