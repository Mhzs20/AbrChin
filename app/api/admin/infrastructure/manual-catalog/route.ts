import { createHash } from "node:crypto";

import {
  CatalogMappingStatus,
  DeliveryMode,
  InfrastructurePlanPublicationStatus,
  InfrastructureOfferSource,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  ProviderCatalogItemSource,
  ProviderCatalogStatus,
  type Prisma,
} from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  jsonError,
  jsonOk,
  readIdempotencyKey,
  rejectCrossOrigin,
} from "@/lib/http";
import { IdempotencyConflictError, stableJson } from "@/lib/idempotency";
import { assertPositiveIntegerToman, tomanToRial } from "@/lib/money";
import { isRegionEnabledForSale } from "@/lib/infrastructure/provider-region-config";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

function positiveInteger(value: unknown, name: string, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > max
  ) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

function optionalDescription(value: unknown) {
  if (typeof value !== "string") return null;
  const description = value.trim();
  return description ? description.slice(0, 500) : null;
}

function manualRequestFingerprint(input: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const regionCode =
      typeof body.regionCode === "string" ? body.regionCode.trim().toLowerCase() : "";
    const externalPlanId =
      typeof body.externalPlanId === "string" ? body.externalPlanId.trim() : "";
    const requestedSource =
      body.offerSource === "MANUAL_ADMIN"
        ? InfrastructureOfferSource.MANUAL_ADMIN
        : body.offerSource === "PREPROVISIONED_INVENTORY"
          ? InfrastructureOfferSource.PREPROVISIONED_INVENTORY
          : null;
    if (!requestedSource) {
      return jsonError(
        "منبع دستی باید موجودی Admin یا Resource ازپیش‌ساخته باشد.",
        400,
      );
    }
    if (!/^[A-Z0-9_-]{3,64}$/.test(code) || !title || title.length > 120) {
      return jsonError("کد یا عنوان معتبر نیست.", 400);
    }
    if (!/^[a-z0-9._-]{2,64}$/.test(regionCode)) {
      return jsonError("کد موقعیت معتبر نیست.", 400);
    }
    if (
      requestedSource !== InfrastructureOfferSource.MANUAL_ADMIN &&
      !/^[a-zA-Z0-9._-]{1,128}$/.test(externalPlanId)
    ) {
      return jsonError("Plan ID واقعی Provider معتبر نیست.", 400);
    }
    const effectiveExternalPlanId =
      requestedSource === InfrastructureOfferSource.MANUAL_ADMIN
        ? `manual-${code.toLowerCase()}`
        : externalPlanId;
    const existingProviderItem = await prisma.providerCatalogItem.findUnique({
      where: {
        provider_apiVersion_regionCode_externalPlanId: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          regionCode,
          externalPlanId: effectiveExternalPlanId,
        },
      },
      select: { id: true, source: true },
    });
    if (existingProviderItem) {
      return jsonError(
        "این Plan در Catalog موجود است؛ آن را از فهرست Catalog منتشر کنید.",
        409,
        { catalogItemId: existingProviderItem.id },
      );
    }
    if (
      requestedSource !== InfrastructureOfferSource.MANUAL_ADMIN &&
      !(await isRegionEnabledForSale({
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode,
      }))
    ) {
      return jsonError("Region برای فروش فعال نیست.", 409);
    }
    const imageAssetId =
      typeof body.imageAssetId === "string" ? body.imageAssetId.trim() : "";
    const manualImageCode =
      typeof body.imageCode === "string" ? body.imageCode.trim() : "";
    const image = requestedSource === InfrastructureOfferSource.MANUAL_ADMIN
      ? null
      : await prisma.providerCatalogAsset.findFirst({
      where: {
        id: imageAssetId,
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode,
        kind: "IMAGE",
        status: ProviderCatalogStatus.ACTIVE,
        available: true,
      },
    });
    if (
      requestedSource !== InfrastructureOfferSource.MANUAL_ADMIN &&
      !image
    ) return jsonError("Image معتبر این Region پیدا نشد.", 409);
    if (
      requestedSource === InfrastructureOfferSource.MANUAL_ADMIN &&
      !/^[a-zA-Z0-9._ -]{2,80}$/.test(manualImageCode)
    ) return jsonError("نام سیستم‌عامل معتبر نیست.", 400);

    const vcpu = positiveInteger(body.vcpu, "vcpu", 256);
    const ramGb = positiveInteger(body.ramGb, "ram_gb", 2048);
    const storageGb = positiveInteger(body.storageGb, "storage_gb", 100_000);
    const offerSource = requestedSource;
    const availableUnits =
      offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
        ? null
        : positiveInteger(
            body.availableUnits,
            "available_units",
            100_000,
          );
    const basePriceRial = tomanToRial(assertPositiveIntegerToman(body.basePriceToman));
    const deliveryEstimateMinutes = positiveInteger(
      body.deliveryEstimateMinutes ?? 15,
      "delivery_estimate",
      30 * 24 * 60,
    );
    const priceValidUntil = new Date(String(body.priceValidUntil ?? ""));
    if (
      Number.isNaN(priceValidUntil.getTime()) ||
      priceValidUntil.getTime() <= Date.now()
    ) {
      return jsonError("تاریخ اعتبار قیمت باید در آینده باشد.", 400);
    }
    const publish =
      body.publish === true &&
      offerSource !== InfrastructureOfferSource.PREPROVISIONED_INVENTORY;
    const requestFingerprint = manualRequestFingerprint({
      code,
      title,
      regionCode,
      externalPlanId: effectiveExternalPlanId,
      imageAssetId,
      manualImageCode,
      vcpu,
      ramGb,
      storageGb,
      availableUnits,
      basePriceRial: basePriceRial.toString(),
      deliveryEstimateMinutes,
      priceValidUntil: priceValidUntil.toISOString(),
      publish,
      offerSource,
      instantDelivery: body.instantDelivery === true,
      description: optionalDescription(body.description),
    });
    const meta = await readRequestMeta(request);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`manual-catalog:${idempotencyKey}`}, 0)
        )::text AS locked
      `;
      const replay = await tx.auditLog.findUnique({ where: { idempotencyKey } });
      if (replay) {
        const previous = replay.afterData as Record<string, unknown> | null;
        if (
          replay.actorUserId !== admin.id ||
          replay.action !== AuditActions.MANUAL_CATALOG_CREATE ||
          previous?.requestFingerprint !== requestFingerprint ||
          !replay.entityId
        ) {
          throw new IdempotencyConflictError();
        }
        return tx.infrastructurePlan.findUniqueOrThrow({
          where: { id: replay.entityId },
          include: { catalogItem: true },
        });
      }
      const now = new Date();
      const externalId = effectiveExternalPlanId;
      const productKind =
        offerSource === InfrastructureOfferSource.MANUAL_ADMIN ||
        offerSource === InfrastructureOfferSource.PREPROVISIONED_INVENTORY
          ? InfrastructureProductKind.READY_INSTANT_SERVER
          : InfrastructureProductKind.CLOUD_SERVER;
      const imageCode = image?.externalId ?? manualImageCode;
      const rawPayload = {
        source:
          offerSource === InfrastructureOfferSource.MANUAL_ADMIN
            ? "manual_admin"
            : "manual_api_backed",
        createdBy: admin.id,
        resourceContract: { vcpu, ramGb, storageGb },
      } satisfies Prisma.InputJsonObject;
      const payloadHash = createHash("sha256")
        .update(stableJson(rawPayload))
        .digest("hex");
      const catalogItem = await tx.providerCatalogItem.create({
        data: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          productKind,
          source:
            offerSource === InfrastructureOfferSource.MANUAL_ADMIN
              ? ProviderCatalogItemSource.MANUAL_ADMIN
              : ProviderCatalogItemSource.MANUAL_API_BACKED,
          regionCode,
          sizeCode: externalId,
          externalPlanId: externalId,
          externalKey: `manual:arvan:v1:${regionCode}:${externalId}`,
          sizeName: title,
          compatibleImageCodes: [imageCode],
          vcpu,
          ramMb: ramGb * 1024,
          diskGb: storageGb,
          available: true,
          active: true,
          status: ProviderCatalogStatus.ACTIVE,
          priceMonthlyAmount: basePriceRial * 1_000_000n,
          priceScale: 6,
          currencyCode: "IRR",
          amountUnit: "RIAL",
          providerMonthlyPriceIrr: basePriceRial,
          lastSyncedAt: now,
          lastSeenAt: now,
          rawPayload,
          payloadHash,
          catalogVersion: `manual:arvan:v1:${now.toISOString()}`,
          manualAvailableUnits: availableUnits,
          manualPriceValidUntil: priceValidUntil,
          manualLastVerifiedAt: now,
          manualUpdatedById: admin.id,
        },
      });
      const plan = await tx.infrastructurePlan.create({
        data: {
          code,
          title,
          description: optionalDescription(body.description),
          provider: InfrastructureProvider.ARVAN,
          providerApiVersion: "v1",
          productKind,
          regionCode,
          sizeCode: externalId,
          imageCode,
          deliveryMode: DeliveryMode.MANAGED,
          vcpu,
          ramGb,
          storageGb,
          salePriceRial: basePriceRial,
          renewalPriceRial: basePriceRial,
          estimatedProviderCostRial: basePriceRial,
          deliveryEstimateMinutes,
          parchinIncluded: true,
          minimumParchinLevel: ParchinLevel.PARCHIN_START,
          active: publish,
          publicationStatus: publish
            ? InfrastructurePlanPublicationStatus.PUBLISHED
            : InfrastructurePlanPublicationStatus.DRAFT,
          instantDelivery: body.instantDelivery === true,
          displayDuringProviderOutage: true,
          offerSource,
          offerPriceValidUntil: priceValidUntil,
          offerLastVerifiedAt: now,
          sortOrder:
            typeof body.sortOrder === "number" && Number.isSafeInteger(body.sortOrder)
              ? body.sortOrder
              : 0,
          catalogItemId: catalogItem.id,
          catalogMappingStatus: CatalogMappingStatus.MAPPED,
          catalogMappedAt: now,
          updatedById: admin.id,
        },
        include: { catalogItem: true },
      });
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.MANUAL_CATALOG_CREATE,
          entityType: "infrastructure_plan",
          entityId: plan.id,
          afterData: {
            requestFingerprint,
            catalogItemId: catalogItem.id,
            source: offerSource,
            provider: "ARVAN",
            regionCode,
            publicationStatus: plan.publicationStatus,
          },
          idempotencyKey,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
      return plan;
    });
    return jsonOk({
      plan: {
        id: result.id,
        code: result.code,
        catalogItemId: result.catalogItemId,
        publicationStatus: result.publicationStatus,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    if (error instanceof SyntaxError) return jsonError("بدنه درخواست معتبر نیست.", 400);
    console.error("[admin/manual-catalog]", error instanceof Error ? error.message : "unknown");
    return jsonError("ایجاد سرور دستی ممکن نیست.", 400);
  }
}
