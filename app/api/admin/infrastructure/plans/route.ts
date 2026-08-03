import {
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  InfrastructureProductKind,
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
import { parseMarkupPercentToBasisPoints } from "@/lib/pricing/provider-pricing";
import { readRequestMeta } from "@/lib/session";
import { billingDefaultsForNewPlan } from "@/lib/billing/policy-admin";

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
        provider: plan.provider,
        offerSource: plan.offerSource,
        publicationStatus: plan.publicationStatus,
        skuMarkupBasisPoints: plan.skuMarkupBasisPoints,
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
    if (body.offerSource && body.offerSource !== "API_CATALOG") {
      return jsonError("موجودی دستی فقط از مسیر اختصاصی خود مدیریت می‌شود.", 400);
    }
    const catalogItem = await prisma.providerCatalogItem.findUnique({
      where: { id: catalogItemId },
    });
    if (
      !catalogItem ||
      catalogItem.apiVersion !== "v1" ||
      catalogItem.source !== "API_CATALOG" ||
      ![
        InfrastructureProductKind.CLOUD_SERVER,
        InfrastructureProductKind.READY_INSTANT_SERVER,
      ].includes(catalogItem.productKind)
    ) {
      return jsonError("Catalog Item معتبر نیست.", 400);
    }
    if (!compatibleImageCodes(catalogItem).includes(imageCode)) {
      return jsonError("Image با Region و Size انتخاب‌شده سازگار نیست.", 400);
    }
    let skuMarkupBasisPoints: number | null = null;
    if (body.skuMarkupPercent != null && String(body.skuMarkupPercent).trim() !== "") {
      try {
        skuMarkupBasisPoints = parseMarkupPercentToBasisPoints(body.skuMarkupPercent);
      } catch {
        return jsonError("درصد افزایش اختصاصی SKU معتبر نیست.", 400);
      }
    }
    const [pricingConfig, productPricingConfig] = await Promise.all([
      prisma.providerPricingConfig.findUnique({
        where: { provider: catalogItem.provider },
      }),
      prisma.productPricingConfig.findUnique({
        where: {
          provider_apiVersion_productKind: {
            provider: catalogItem.provider,
            apiVersion: catalogItem.apiVersion,
            productKind: catalogItem.productKind,
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
      const globalBillingPolicy =
        catalogItem.productKind === InfrastructureProductKind.CLOUD_SERVER
          ? await tx.billingPolicyVersion.findFirst({
              where: {
                policyKey: "global",
                scope: "GLOBAL",
                effectiveFrom: { lte: new Date() },
                effectiveTo: null,
              },
              orderBy: { version: "desc" },
            })
          : null;
      const billingDefaults = billingDefaultsForNewPlan(
        catalogItem.productKind,
        globalBillingPolicy?.id ?? null,
      );
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
          productKind: catalogItem.productKind,
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
          skuMarkupBasisPoints,
          deliveryEstimateMinutes: assertPositiveIntegerToman(
            body.deliveryEstimateMinutes,
          ),
          parchinIncluded: true,
          minimumParchinLevel: ParchinLevel.PARCHIN_START,
          // Raw Provider offers only become local drafts. Publishing is a
          // separate, audited Admin action after the mapping has been reviewed.
          active: false,
          publicationStatus: InfrastructurePlanPublicationStatus.DRAFT,
          instantDelivery: body.instantDelivery === true,
          displayDuringProviderOutage:
            body.displayDuringProviderOutage !== false,
          offerSource: "API_CATALOG",
          offerPriceValidUntil: null,
          offerLastVerifiedAt: null,
          ...billingDefaults,
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
            publicationStatus: created.publicationStatus,
            skuMarkupBasisPoints: created.skuMarkupBasisPoints,
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
