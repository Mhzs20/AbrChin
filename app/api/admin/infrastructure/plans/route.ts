import {
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  InfrastructureOfferSource,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
} from "@prisma/client";
import { createHash } from "node:crypto";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { IdempotencyConflictError, stableJson } from "@/lib/idempotency";
import { assertPositiveIntegerToman } from "@/lib/money";
import { listAllPlans } from "@/lib/orders/plans";
import {
  compatibleImageCodes,
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import { readRequestMeta } from "@/lib/session";
import { READY_SERVER_PLAN_PREFIX } from "@/lib/cloud-servers/catalog";
import { isRegionEnabledForSale } from "@/lib/infrastructure/provider-region-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    const plans = await listAllPlans();
    return jsonOk({
      plans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        title: plan.title,
        description: plan.description,
        deliveryMode: plan.deliveryMode,
        productKind: plan.productKind,
        offerSource: plan.offerSource,
        regionCode: plan.regionCode,
        sizeCode: plan.sizeCode,
        imageCode: plan.imageCode,
        catalogItemId: plan.catalogItemId,
        catalogMappingStatus: plan.catalogMappingStatus,
        vcpu: plan.catalogItem?.vcpu ?? plan.vcpu,
        ramGb:
          plan.catalogItem?.ramMb == null
            ? plan.ramGb
            : Math.ceil(plan.catalogItem.ramMb / 1024),
        storageGb: plan.catalogItem?.diskGb ?? plan.storageGb,
        basePriceRial: plan.pricing?.providerBasePriceRial.toString() ?? null,
        finalPriceRial: plan.pricing?.finalPriceRial.toString() ?? null,
        available: plan.catalogItem?.available === true,
        lastSyncedAt: plan.catalogItem?.lastSyncedAt.toISOString() ?? null,
        deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
        parchinIncluded: plan.parchinIncluded,
        active: plan.active,
        sortOrder: plan.sortOrder,
      })),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/plans/get]", error instanceof Error ? error.message : "unknown");
    return jsonError("دریافت پلن‌ها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const meta = await readRequestMeta(request);
    const body = (await request.json()) as Record<string, unknown>;

    const code = typeof body.code === "string" ? body.code.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!code || !title) return jsonError("کد و عنوان الزامی است.", 400);
    if (code.startsWith(READY_SERVER_PLAN_PREFIX)) {
      return jsonError("این پیشوند برای پلن‌های خودکار سرور آماده رزرو شده است.", 400);
    }
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
      "storageGb" in body
    ) {
      return jsonError("قیمت و منابع فقط از کاتالوگ Provider خوانده می‌شوند.", 400);
    }
    const catalogItemId =
      typeof body.catalogItemId === "string" ? body.catalogItemId.trim() : "";
    const imageCode = typeof body.imageCode === "string" ? body.imageCode.trim() : "";
    const offerSource =
      body.offerSource === "PREPROVISIONED_INVENTORY"
        ? InfrastructureOfferSource.PREPROVISIONED_INVENTORY
        : InfrastructureOfferSource.API_CATALOG;
    const productKind =
      body.productKind === InfrastructureProductKind.READY_INSTANT_SERVER
        ? InfrastructureProductKind.READY_INSTANT_SERVER
        : InfrastructureProductKind.CLOUD_SERVER;
    if (
      offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY &&
      productKind !== InfrastructureProductKind.READY_INSTANT_SERVER
    ) {
      return jsonError("موجودی ازپیش‌ساخته فقط در مسیر سرور فوری مجاز است.", 400);
    }
    const offerPriceValidUntil =
      offerSource === InfrastructureOfferSource.API_CATALOG
        ? null
        : new Date(String(body.offerPriceValidUntil ?? ""));
    if (
      offerSource !== InfrastructureOfferSource.API_CATALOG &&
      (!offerPriceValidUntil ||
        Number.isNaN(offerPriceValidUntil.getTime()) ||
        offerPriceValidUntil.getTime() <= Date.now())
    ) {
      return jsonError("اعتبار قیمت برای منبع دستی الزامی است.", 400);
    }
    if (
      offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY &&
      body.active !== false
    ) {
      return jsonError(
        "ابتدا پلن موجودی واقعی را غیرفعال بسازید، Resource را ثبت کنید و سپس منتشر کنید.",
        409,
      );
    }
    const [catalogItem, pricingConfig] = await Promise.all([
      prisma.providerCatalogItem.findUnique({ where: { id: catalogItemId } }),
      prisma.providerPricingConfig.findUnique({
        where: { provider: InfrastructureProvider.ARVAN },
      }),
    ]);
    if (
      !catalogItem ||
      catalogItem.provider !== InfrastructureProvider.ARVAN ||
      catalogItem.apiVersion !== "v1" ||
      catalogItem.productKind !== "CLOUD_SERVER"
    ) {
      return jsonError("Catalog Item معتبر نیست.", 400);
    }
    if (
      !(await isRegionEnabledForSale({
        provider: catalogItem.provider,
        apiVersion: catalogItem.apiVersion,
        regionCode: catalogItem.regionCode,
      }))
    ) {
      return jsonError("Region برای فروش فعال نیست.", 409);
    }
    if (!compatibleImageCodes(catalogItem).includes(imageCode)) {
      return jsonError("Image با Region و Size انتخاب‌شده سازگار نیست.", 400);
    }
    const pricing = pricingConfig
      ? resolveCatalogItemPricing(catalogItem, pricingConfig)
      : null;
    if (body.active !== false && !pricing) {
      return jsonError("Catalog Item ناموجود یا فاقد قرارداد قیمت معتبر است.", 400);
    }

    const requestFingerprint = createHash("sha256")
      .update(stableJson({ body, catalogItemId: catalogItem.id, imageCode }))
      .digest("hex");
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`admin-plan:${idempotencyKey}`}, 0)
        )::text AS locked
      `;
      const replay = await tx.auditLog.findUnique({ where: { idempotencyKey } });
      if (replay) {
        const previous = replay.afterData as Record<string, unknown> | null;
        if (
          replay.actorUserId !== admin.id ||
          replay.action !== AuditActions.PLAN_CREATE ||
          previous?.requestFingerprint !== requestFingerprint ||
          !replay.entityId
        ) {
          throw new IdempotencyConflictError();
        }
        return tx.infrastructurePlan.findUniqueOrThrow({
          where: { id: replay.entityId },
        });
      }
      const created = await tx.infrastructurePlan.create({
        data: {
          code,
          title,
          description:
            typeof body.description === "string"
              ? body.description.trim()
              : null,
          provider: catalogItem.provider,
          providerApiVersion: catalogItem.apiVersion,
          productKind,
          regionCode: catalogItem.regionCode,
          sizeCode: catalogItem.sizeCode,
          imageCode,
          deliveryMode: DeliveryMode.MANAGED,
          vcpu: catalogItem.vcpu,
          ramGb:
            catalogItem.ramMb == null
              ? null
              : Math.ceil(catalogItem.ramMb / 1024),
          storageGb: catalogItem.diskGb,
          salePriceRial: pricing?.finalPriceRial ?? 1n,
          renewalPriceRial: pricing?.finalPriceRial ?? 1n,
          estimatedProviderCostRial: pricing?.providerBasePriceRial ?? 1n,
          deliveryEstimateMinutes: assertPositiveIntegerToman(
            body.deliveryEstimateMinutes,
          ),
          parchinIncluded: true,
          minimumParchinLevel: ParchinLevel.PARCHIN_START,
          active: body.active !== false && pricing != null,
          publicationStatus:
            body.active !== false && pricing != null
              ? InfrastructurePlanPublicationStatus.PUBLISHED
              : InfrastructurePlanPublicationStatus.DRAFT,
          instantDelivery: body.instantDelivery === true,
          displayDuringProviderOutage:
            body.displayDuringProviderOutage !== false,
          offerSource,
          offerPriceValidUntil,
          offerLastVerifiedAt:
            offerSource === InfrastructureOfferSource.API_CATALOG
              ? null
              : new Date(),
          sortOrder: Number(body.sortOrder ?? 0),
          catalogItemId: catalogItem.id,
          catalogMappingStatus: "MAPPED",
          catalogMappedAt: new Date(),
          updatedById: admin.id,
        },
      });
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.PLAN_CREATE,
          entityType: "infrastructure_plan",
          entityId: created.id,
          afterData: {
            code: created.code,
            title: created.title,
            requestFingerprint,
          },
          idempotencyKey,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
      return created;
    });

    return jsonOk({ plan: { id: plan.id, code: plan.code } });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    console.error("[admin/plans/post]", error instanceof Error ? error.message : "unknown");
    return jsonError("ایجاد پلن ممکن نیست.", 500);
  }
}
