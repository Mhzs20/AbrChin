import { DeliveryMode } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { assertPositiveIntegerToman } from "@/lib/money";
import {
  compatibleImageCodes,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const { id } = await params;
    const before = await prisma.infrastructurePlan.findUnique({
      where: { id },
      include: { catalogItem: true },
    });
    if (!before) return jsonError("پلن پیدا نشد.", 404);

    const body = (await request.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = { updatedById: admin.id };
    if (
      "salePriceToman" in body ||
      "renewalPriceToman" in body ||
      "estimatedProviderCostToman" in body ||
      "vcpu" in body ||
      "ramGb" in body ||
      "storageGb" in body ||
      "regionCode" in body ||
      "sizeCode" in body
    ) {
      return jsonError("قیمت، منابع، Region و Size فقط از Catalog Item خوانده می‌شوند.", 400);
    }

    if (typeof body.title === "string") data.title = body.title.trim();
    if (typeof body.description === "string") data.description = body.description.trim();
    if (body.deliveryMode === "MANAGED" || body.deliveryMode === "RAW") {
      data.deliveryMode = body.deliveryMode as DeliveryMode;
    }
    const catalogItemId =
      typeof body.catalogItemId === "string"
        ? body.catalogItemId.trim()
        : before.catalogItemId;
    const catalogItem = catalogItemId
      ? await prisma.providerCatalogItem.findUnique({ where: { id: catalogItemId } })
      : null;
    if (!catalogItem || catalogItem.provider !== before.provider) {
      return jsonError("Catalog Item معتبر نیست.", 400);
    }
    const imageCode =
      typeof body.imageCode === "string" ? body.imageCode.trim() : before.imageCode;
    if (!compatibleImageCodes(catalogItem).includes(imageCode)) {
      return jsonError("Image با Catalog Item سازگار نیست.", 400);
    }
    const pricingConfig = await prisma.providerPricingConfig.findUnique({
      where: { provider: before.provider },
    });
    const pricing = pricingConfig
      ? resolveCatalogItemPricing(catalogItem, pricingConfig)
      : null;
    const requestedActive =
      typeof body.active === "boolean" ? body.active : before.active;
    if (requestedActive && !pricing) {
      return jsonError("Catalog Item ناموجود یا فاقد قرارداد قیمت معتبر است.", 400);
    }
    Object.assign(data, {
      catalogItemId: catalogItem.id,
      catalogMappingStatus: "MAPPED",
      catalogMappedAt: new Date(),
      regionCode: catalogItem.regionCode,
      sizeCode: catalogItem.sizeCode,
      imageCode,
      vcpu: catalogItem.vcpu,
      ramGb:
        catalogItem.ramMb == null ? null : Math.ceil(catalogItem.ramMb / 1024),
      storageGb: catalogItem.diskGb,
      active: requestedActive && pricing != null,
      ...(pricing
        ? {
            salePriceRial: pricing.finalPriceRial,
            renewalPriceRial: pricing.finalPriceRial,
            estimatedProviderCostRial: pricing.providerBasePriceRial,
          }
        : {}),
    });
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
