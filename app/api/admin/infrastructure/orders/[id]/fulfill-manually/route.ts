import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
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
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const meta = await readRequestMeta(request);
    const result = await completeManualReadyDelivery({
      infrastructureOrderId: id,
      adminUserId: admin.id,
      providerResourceId: typeof body.providerResourceId === "string" ? body.providerResourceId : "",
      ipv4: typeof body.ipv4 === "string" ? body.ipv4 : "",
      region: typeof body.region === "string" ? body.region : "",
      externalPlanId: typeof body.externalPlanId === "string" ? body.externalPlanId : "",
      externalImageId: typeof body.externalImageId === "string" ? body.externalImageId : "",
      username: typeof body.username === "string" ? body.username : "",
      secret: typeof body.secret === "string" ? body.secret : "",
      reason: typeof body.reason === "string" ? body.reason : "",
      idempotencyKey: request.headers.get("Idempotency-Key") ?? "",
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
    console.error("[admin/manual-fulfillment]", error instanceof Error ? error.message : "unknown");
    return jsonError("ثبت Fulfillment دستی ممکن نیست.", 500);
  }
}
