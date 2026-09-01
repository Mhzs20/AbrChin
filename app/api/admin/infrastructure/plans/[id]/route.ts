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
  PricingUnavailableError,
  requireVerifiedSellablePricing,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import { parseMarkupPercentToBasisPoints } from "@/lib/pricing/provider-pricing";
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
    if (
      !catalogItem ||
      catalogItem.provider !== before.provider ||
      catalogItem.apiVersion !== before.providerApiVersion
    ) {
      return jsonError("Catalog Item معتبر نیست.", 400);
    }
    const isLegacyArvanReadyMapping =
      before.provider === "ARVAN" &&
      before.productKind === "READY_INSTANT_SERVER" &&
      catalogItem.productKind === "CLOUD_SERVER";
    if (
      catalogItem.productKind !== before.productKind &&
      !isLegacyArvanReadyMapping
    ) {
      return jsonError("Catalog Item با مسیر محصول این SKU سازگار نیست.", 400);
    }
    const imageCode =
      typeof body.imageCode === "string" ? body.imageCode.trim() : before.imageCode;
    if (!compatibleImageCodes(catalogItem).includes(imageCode)) {
      return jsonError("Image با Catalog Item سازگار نیست.", 400);
    }
    let skuMarkupBasisPoints = before.skuMarkupBasisPoints;
    if (body.skuMarkupPercent != null) {
      if (String(body.skuMarkupPercent).trim() === "") {
        skuMarkupBasisPoints = null;
      } else {
        try {
          skuMarkupBasisPoints = parseMarkupPercentToBasisPoints(body.skuMarkupPercent);
        } catch {
          return jsonError("درصد افزایش اختصاصی SKU معتبر نیست.", 400);
        }
      }
    }
    const [pricingConfig, productPricingConfig] = await Promise.all([
      prisma.providerPricingConfig.findUnique({
        where: { provider: before.provider },
      }),
      prisma.productPricingConfig.findUnique({
        where: {
          provider_apiVersion_productKind: {
            provider: before.provider,
            apiVersion: before.providerApiVersion,
            productKind: before.productKind,
          },
        },
      }),
    ]);
    const pricing = pricingConfig?.enabled && productPricingConfig?.enabled
      ? resolveCatalogItemPricing(catalogItem, pricingConfig, {
          productMarkupBasisPoints:
            skuMarkupBasisPoints ?? productPricingConfig.markupBasisPoints,
        })
      : null;
    const requestedPublication =
      typeof body.publicationStatus === "string" &&
      Object.values(InfrastructurePlanPublicationStatus).includes(
        body.publicationStatus as InfrastructurePlanPublicationStatus,
      )
        ? (body.publicationStatus as InfrastructurePlanPublicationStatus)
        : typeof body.active === "boolean"
          ? body.active
            ? InfrastructurePlanPublicationStatus.PUBLISHED
            : InfrastructurePlanPublicationStatus.PAUSED
          : before.publicationStatus;
    const requestedActive =
      requestedPublication === InfrastructurePlanPublicationStatus.PUBLISHED;
    const offerSource = before.offerSource;
    if (body.offerSource && body.offerSource !== before.offerSource) {
      return jsonError("تغییر منبع SKU از این مسیر مجاز نیست.", 400);
    }
    if (
      offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY &&
      before.productKind !== "READY_INSTANT_SERVER"
    ) {
      return jsonError("موجودی ازپیش‌ساخته فقط در مسیر سرور فوری مجاز است.", 400);
    }
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
    if (requestedActive) {
      requireVerifiedSellablePricing(pricing);
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
      publicationStatus: requestedPublication,
      skuMarkupBasisPoints,
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
      action:
        requestedPublication === InfrastructurePlanPublicationStatus.PAUSED ||
        requestedPublication === InfrastructurePlanPublicationStatus.ARCHIVED
          ? AuditActions.PLAN_DISABLE
          : AuditActions.PLAN_UPDATE,
      entityType: "infrastructure_plan",
      entityId: plan.id,
      beforeData: {
        title: before.title,
        active: before.active,
        publicationStatus: before.publicationStatus,
        skuMarkupBasisPoints: before.skuMarkupBasisPoints,
      },
      afterData: {
        title: plan.title,
        active: plan.active,
        publicationStatus: plan.publicationStatus,
        skuMarkupBasisPoints: plan.skuMarkupBasisPoints,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({
      plan: {
        id: plan.id,
        code: plan.code,
        active: plan.active,
        publicationStatus: plan.publicationStatus,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof PricingUnavailableError) {
      return jsonError(error.message, 409, { code: error.code });
    }
    console.error("[admin/plans/patch]", error instanceof Error ? error.message : "unknown");
    return jsonError("به‌روزرسانی پلن ممکن نیست.", 500);
  }
}
