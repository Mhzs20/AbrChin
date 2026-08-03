import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { approveActivation } from "@/lib/billing/activation";
import { jsonError, jsonOk, readIdempotencyKey, rejectCrossOrigin } from "@/lib/http";
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
    const body = (await request.json()) as Record<string, unknown>;
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) {
      return jsonError("شناسه یکتای عملیات الزامی است.", 400);
    }
    const meta = await readRequestMeta(request);
    return jsonOk(
      await approveActivation({
        activationRequestId: id,
        adminUserId: admin.id,
        reason: typeof body.reason === "string" ? body.reason : "",
        idempotencyKey,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  } catch (error) {
    const authError = adminApiError(error);
    if (authError) {
      return jsonError(authError.message, authError.status);
    }
    if (error instanceof WalletError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    console.error(
      "[admin/activation/approve]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("تأیید فعال‌سازی ممکن نیست.", 500);
  }
}
