import {
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  InfrastructureOfferSource,
} from "@prisma/client";

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
import { isRegionEnabledForSale } from "@/lib/infrastructure/provider-region-config";
import { countAvailableInventoryByPlan } from "@/lib/infrastructure/preprovisioned-inventory";

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
      body.deliveryMode === "RAW" ||
      ("parchinIncluded" in body && body.parchinIncluded !== true)
    ) {
      return jsonError("تمام سرورهای ابرچین فقط همراه با پرچین فروخته می‌شوند.", 400);
    }
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
    data.deliveryMode = DeliveryMode.MANAGED;
    data.parchinIncluded = true;
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
    const offerSource =
      body.offerSource === "API_CATALOG" ||
      body.offerSource === "MANUAL_API_BACKED" ||
      body.offerSource === "PREPROVISIONED_INVENTORY"
        ? body.offerSource
        : before.offerSource;
    const offerPriceValidUntil =
      offerSource === InfrastructureOfferSource.API_CATALOG
        ? null
        : body.offerPriceValidUntil == null
          ? before.offerPriceValidUntil
          : new Date(String(body.offerPriceValidUntil));
    if (
      offerSource !== InfrastructureOfferSource.API_CATALOG &&
      (!offerPriceValidUntil ||
        Number.isNaN(offerPriceValidUntil.getTime()) ||
        offerPriceValidUntil.getTime() <= Date.now())
    ) {
      return jsonError("اعتبار قیمت برای منبع دستی الزامی است.", 400);
    }
    if (requestedActive && !pricing) {
      return jsonError("Catalog Item ناموجود یا فاقد قرارداد قیمت معتبر است.", 400);
    }
    if (
      requestedActive &&
      before.provider === "ARVAN" &&
      !(await isRegionEnabledForSale({
        provider: before.provider,
        apiVersion: before.providerApiVersion,
        regionCode: catalogItem.regionCode,
      }))
    ) {
      return jsonError("Region برای فروش فعال نیست.", 409);
    }
    if (
      requestedActive &&
      offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
    ) {
      const inventoryCount =
        (await countAvailableInventoryByPlan([before.id])).get(before.id) ??
        0;
      if (inventoryCount === 0) {
        return jsonError(
          "بدون Inventory Row سالم و واقعی، انتشار این پلن مجاز نیست.",
          409,
        );
      }
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
      publicationStatus:
        requestedActive && pricing != null
          ? InfrastructurePlanPublicationStatus.PUBLISHED
          : InfrastructurePlanPublicationStatus.PAUSED,
      offerSource,
      offerPriceValidUntil,
      offerLastVerifiedAt:
        offerSource === InfrastructureOfferSource.API_CATALOG
          ? null
          : new Date(),
      ...(typeof body.instantDelivery === "boolean"
        ? { instantDelivery: body.instantDelivery }
        : {}),
      ...(typeof body.displayDuringProviderOutage === "boolean"
        ? { displayDuringProviderOutage: body.displayDuringProviderOutage }
        : {}),
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
