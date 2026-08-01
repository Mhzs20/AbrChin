import { createHash } from "node:crypto";

import {
  InfrastructurePlanPublicationStatus,
  InfrastructureOfferSource,
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
import { readRequestMeta } from "@/lib/session";
import { countAvailableInventoryByPlan } from "@/lib/infrastructure/preprovisioned-inventory";

export const dynamic = "force-dynamic";

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const before = await prisma.providerCatalogItem.findUnique({
      where: { id },
      include: { plans: true },
    });
    if (
      !before ||
      (before.source !== ProviderCatalogItemSource.MANUAL_API_BACKED &&
        before.source !== ProviderCatalogItemSource.MANUAL_ADMIN)
    ) {
      return jsonError("سرور دستی پیدا نشد.", 404);
    }
    const plan = before.plans[0];
    if (!plan) return jsonError("پلن متصل به سرور دستی پیدا نشد.", 409);
    if (
      before.source === ProviderCatalogItemSource.MANUAL_API_BACKED &&
      plan.offerSource !== InfrastructureOfferSource.PREPROVISIONED_INVENTORY
    ) {
      return jsonError(
        "قیمت پایهٔ پلن متکی به API از این مسیر قابل‌ویرایش نیست.",
        409,
      );
    }
    const availableUnits =
      body.availableUnits == null
        ? before.manualAvailableUnits ?? 0
        : Number(body.availableUnits);
    if (!Number.isSafeInteger(availableUnits) || availableUnits < 0) {
      return jsonError("ظرفیت دستی معتبر نیست.", 400);
    }
    const basePriceRial =
      body.basePriceToman == null
        ? before.providerMonthlyPriceIrr
        : tomanToRial(assertPositiveIntegerToman(body.basePriceToman));
    if (!basePriceRial || basePriceRial <= 0n) {
      return jsonError("قیمت پایه معتبر نیست.", 400);
    }
    const priceValidUntil =
      body.priceValidUntil == null
        ? before.manualPriceValidUntil
        : new Date(String(body.priceValidUntil));
    if (
      !priceValidUntil ||
      Number.isNaN(priceValidUntil.getTime()) ||
      priceValidUntil.getTime() <= Date.now()
    ) {
      return jsonError("اعتبار قیمت باید در آینده باشد.", 400);
    }
    const publish =
      typeof body.publish === "boolean"
        ? body.publish
        : plan.publicationStatus === InfrastructurePlanPublicationStatus.PUBLISHED;
    if (
      publish &&
      (plan.offerSource === InfrastructureOfferSource.MANUAL_API_BACKED ||
        plan.offerSource === InfrastructureOfferSource.MANUAL_ADMIN) &&
      availableUnits === 0
    ) {
      return jsonError("پلن بدون ظرفیت قابل انتشار نیست.", 409);
    }
    if (
      publish &&
      plan.offerSource ===
        InfrastructureOfferSource.PREPROVISIONED_INVENTORY &&
      ((await countAvailableInventoryByPlan([plan.id])).get(plan.id) ?? 0) ===
        0
    ) {
      return jsonError(
        "بدون Inventory Row سالم و واقعی، انتشار مجاز نیست.",
        409,
      );
    }
    const deliveryEstimateMinutes =
      body.deliveryEstimateMinutes == null
        ? plan.deliveryEstimateMinutes
        : Number(body.deliveryEstimateMinutes);
    if (
      !Number.isSafeInteger(deliveryEstimateMinutes) ||
      deliveryEstimateMinutes <= 0 ||
      deliveryEstimateMinutes > 30 * 24 * 60
    ) {
      return jsonError("زمان تحویل معتبر نیست.", 400);
    }
    const requestFingerprint = fingerprint({
      catalogItemId: id,
      availableUnits,
      basePriceRial: basePriceRial.toString(),
      priceValidUntil: priceValidUntil.toISOString(),
      publish,
      title: typeof body.title === "string" ? body.title.trim() : plan.title,
      instantDelivery:
        typeof body.instantDelivery === "boolean"
          ? body.instantDelivery
          : plan.instantDelivery,
      deliveryEstimateMinutes,
      description:
        typeof body.description === "string"
          ? body.description.trim().slice(0, 500)
          : plan.description,
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
          replay.action !== AuditActions.MANUAL_CATALOG_UPDATE ||
          replay.entityId !== plan.id ||
          previous?.requestFingerprint !== requestFingerprint
        ) {
          throw new IdempotencyConflictError();
        }
        return tx.infrastructurePlan.findUniqueOrThrow({ where: { id: plan.id } });
      }
      const now = new Date();
      const raw = {
        source:
          before.source === ProviderCatalogItemSource.MANUAL_ADMIN
            ? "manual_admin"
            : "manual_api_backed",
        updatedBy: admin.id,
        availableUnits,
      } satisfies Prisma.InputJsonObject;
      await tx.providerCatalogItem.update({
        where: { id },
        data: {
          sizeName:
            typeof body.title === "string" && body.title.trim()
              ? body.title.trim().slice(0, 120)
              : before.sizeName,
          providerMonthlyPriceIrr: basePriceRial,
          priceMonthlyAmount: basePriceRial * 1_000_000n,
          manualAvailableUnits: availableUnits,
          manualPriceValidUntil: priceValidUntil,
          manualLastVerifiedAt: now,
          manualUpdatedById: admin.id,
          available: availableUnits > 0,
          active: true,
          status:
            availableUnits > 0
              ? ProviderCatalogStatus.ACTIVE
              : ProviderCatalogStatus.UNAVAILABLE,
          unavailableAt: availableUnits > 0 ? null : now,
          lastSyncedAt: now,
          lastSeenAt: now,
          catalogVersion: `manual:arvan:v1:${now.toISOString()}`,
          payloadHash: createHash("sha256").update(stableJson(raw)).digest("hex"),
          rawPayload: raw,
        },
      });
      const saved = await tx.infrastructurePlan.update({
        where: { id: plan.id },
        data: {
          ...(typeof body.title === "string" && body.title.trim()
            ? { title: body.title.trim().slice(0, 120) }
            : {}),
          ...(typeof body.description === "string"
            ? {
                description: body.description.trim()
                  ? body.description.trim().slice(0, 500)
                  : null,
              }
            : {}),
          salePriceRial: basePriceRial,
          renewalPriceRial: basePriceRial,
          estimatedProviderCostRial: basePriceRial,
          active:
            publish &&
            (plan.offerSource ===
              InfrastructureOfferSource.PREPROVISIONED_INVENTORY ||
              availableUnits > 0),
          publicationStatus: publish
            ? InfrastructurePlanPublicationStatus.PUBLISHED
            : InfrastructurePlanPublicationStatus.PAUSED,
          ...(typeof body.instantDelivery === "boolean"
            ? { instantDelivery: body.instantDelivery }
            : {}),
          ...(typeof body.sortOrder === "number" && Number.isSafeInteger(body.sortOrder)
            ? { sortOrder: body.sortOrder }
            : {}),
          deliveryEstimateMinutes,
          offerPriceValidUntil: priceValidUntil,
          offerLastVerifiedAt: now,
          updatedById: admin.id,
        },
      });
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.MANUAL_CATALOG_UPDATE,
          entityType: "infrastructure_plan",
          entityId: plan.id,
          beforeData: {
            availableUnits: before.manualAvailableUnits,
            basePriceRial: before.providerMonthlyPriceIrr?.toString() ?? null,
            publicationStatus: plan.publicationStatus,
          },
          afterData: {
            requestFingerprint,
            availableUnits,
            basePriceRial: basePriceRial.toString(),
            publicationStatus: saved.publicationStatus,
          },
          idempotencyKey,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
      return saved;
    });
    return jsonOk({
      plan: {
        id: result.id,
        code: result.code,
        active: result.active,
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
    console.error("[admin/manual-catalog/update]", error instanceof Error ? error.message : "unknown");
    return jsonError("به‌روزرسانی سرور دستی ممکن نیست.", 400);
  }
}
