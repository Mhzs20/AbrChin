import { DeliveryMode } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { assertPositiveIntegerToman, tomanToRial } from "@/lib/money";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const { id } = await params;
    const before = await prisma.infrastructurePlan.findUnique({ where: { id } });
    if (!before) return jsonError("پلن پیدا نشد.", 404);

    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = { updatedById: admin.id };

    if (typeof body.title === "string") data.title = body.title.trim();
    if (typeof body.description === "string") data.description = body.description.trim();
    if (body.deliveryMode === "MANAGED" || body.deliveryMode === "RAW") {
      data.deliveryMode = body.deliveryMode as DeliveryMode;
    }
    if (typeof body.regionCode === "string") data.regionCode = body.regionCode.trim();
    if (typeof body.sizeCode === "string") data.sizeCode = body.sizeCode.trim();
    if (typeof body.imageCode === "string") data.imageCode = body.imageCode.trim();
    if (body.vcpu != null) data.vcpu = assertPositiveIntegerToman(body.vcpu);
    if (body.ramGb != null) data.ramGb = assertPositiveIntegerToman(body.ramGb);
    if (body.storageGb != null) data.storageGb = assertPositiveIntegerToman(body.storageGb);
    if (body.salePriceToman != null) data.salePriceRial = tomanToRial(assertPositiveIntegerToman(body.salePriceToman));
    if (body.renewalPriceToman != null) {
      data.renewalPriceRial = tomanToRial(assertPositiveIntegerToman(body.renewalPriceToman));
    }
    if (body.estimatedProviderCostToman != null) {
      data.estimatedProviderCostRial = tomanToRial(assertPositiveIntegerToman(body.estimatedProviderCostToman));
    }
    if (typeof body.active === "boolean") data.active = body.active;
    if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
    if (body.deliveryEstimateMinutes != null) {
      data.deliveryEstimateMinutes = assertPositiveIntegerToman(body.deliveryEstimateMinutes);
    }
    if (typeof body.parchinIncluded === "boolean") data.parchinIncluded = body.parchinIncluded;

    const plan = await prisma.infrastructurePlan.update({ where: { id }, data });

    await writeAuditLog({
      actorUserId: admin.id,
      action: body.active === false ? AuditActions.PLAN_DISABLE : AuditActions.PLAN_UPDATE,
      entityType: "infrastructure_plan",
      entityId: plan.id,
      beforeData: { title: before.title, active: before.active },
      afterData: { title: plan.title, active: plan.active },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({ plan: { id: plan.id, code: plan.code, active: plan.active } });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/plans/patch]", error instanceof Error ? error.message : "unknown");
    return jsonError("به‌روزرسانی پلن ممکن نیست.", 500);
  }
}
