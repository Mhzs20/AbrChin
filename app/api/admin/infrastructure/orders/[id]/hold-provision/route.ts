import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { holdProvisionApproval } from "@/lib/infrastructure/provision-approval";
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
    const meta = await readRequestMeta(request);
    const result = await holdProvisionApproval({
      infrastructureOrderId: id,
      adminUserId: admin.id,
      reason: typeof body.reason === "string" ? body.reason : "",
      idempotencyKey: `provision-hold:${id}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return jsonOk(result);
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof WalletError) {
      return jsonError(error.message, error.code === "idempotency_conflict" ? 409 : 400, {
        code: error.code,
      });
    }
    console.error("[admin/hold-provision]", error instanceof Error ? error.message : "unknown");
    return jsonError("نگه‌داشتن سفارش ممکن نیست.", 500);
  }
}
