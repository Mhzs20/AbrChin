import {
  InfrastructureProvider,
  ProviderRegionConfigSource,
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
import { safeProviderSyncCode } from "@/lib/infrastructure/catalog-sync-observability";
import { createCloudProviderAdapter } from "@/lib/infrastructure/provider-factory";
import {
  listProviderRegionConfigs,
  normalizeProviderRegionCode,
  normalizeProviderRegionDisplayName,
} from "@/lib/infrastructure/provider-region-config";
import { readRequestMeta } from "@/lib/session";
import { IdempotencyConflictError } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

async function validateArvanRegion(regionCode: string) {
  const adapter = createCloudProviderAdapter(
    InfrastructureProvider.ARVAN,
    "v1",
    { regionCodes: [regionCode] },
  );
  try {
    const [plans, images, networks, security] = await Promise.all([
      adapter.syncPlans(regionCode),
      adapter.syncImages(regionCode),
      adapter.syncNetworks(regionCode),
      adapter.syncSecurity(regionCode),
    ]);
    if (
      plans.length === 0 ||
      images.length === 0 ||
      networks.length === 0 ||
      security.length === 0
    ) {
      return { ok: false as const, code: "provider_region_contract_empty" };
    }
    return { ok: true as const, code: "provider_region_valid" };
  } catch (error) {
    return { ok: false as const, code: safeProviderSyncCode(error) };
  }
}

export async function GET() {
  try {
    await requireAdminUser();
    const regions = await listProviderRegionConfigs({
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      purpose: "ALL",
    });
    return jsonOk({
      regions: regions.map((region) => ({
        ...region,
        createdAt: region.createdAt.toISOString(),
        updatedAt: region.updatedAt.toISOString(),
        lastValidatedAt: region.lastValidatedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    return jsonError("دریافت Regionها ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const regionCode = normalizeProviderRegionCode(String(body.regionCode ?? ""));
    const displayName = normalizeProviderRegionDisplayName(
      String(body.displayName ?? ""),
    );
    const validation = await validateArvanRegion(regionCode);
    const requestedSync = body.syncEnabled !== false;
    const requestedSale = body.saleEnabled !== false;
    const meta = await readRequestMeta(request);
    const region = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`provider-region:ARVAN:v1:${regionCode}`}, 0)
        )::text AS locked
      `;
      const saved = await tx.providerRegionConfig.upsert({
        where: {
          provider_apiVersion_regionCode: {
            provider: InfrastructureProvider.ARVAN,
            apiVersion: "v1",
            regionCode,
          },
        },
        update: {
          displayName,
          source: ProviderRegionConfigSource.ADMIN,
          syncEnabled: validation.ok && requestedSync,
          saleEnabled: validation.ok && requestedSale,
          sortOrder:
            typeof body.sortOrder === "number" && Number.isSafeInteger(body.sortOrder)
              ? body.sortOrder
              : 0,
          lastValidatedAt: new Date(),
          lastValidationCode: validation.code,
          updatedById: admin.id,
        },
        create: {
          provider: InfrastructureProvider.ARVAN,
          apiVersion: "v1",
          regionCode,
          displayName,
          source: ProviderRegionConfigSource.ADMIN,
          syncEnabled: validation.ok && requestedSync,
          saleEnabled: validation.ok && requestedSale,
          sortOrder:
            typeof body.sortOrder === "number" && Number.isSafeInteger(body.sortOrder)
              ? body.sortOrder
              : 0,
          lastValidatedAt: new Date(),
          lastValidationCode: validation.code,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.PROVIDER_REGION_UPSERT,
          entityType: "provider_region_config",
          entityId: saved.id,
          afterData: {
            provider: "ARVAN",
            apiVersion: "v1",
            regionCode,
            displayName,
            syncEnabled: saved.syncEnabled,
            saleEnabled: saved.saleEnabled,
            validationCode: validation.code,
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
      region: {
        ...region,
        lastValidatedAt: region.lastValidatedAt?.toISOString() ?? null,
      },
      validation,
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
    const code = safeProviderSyncCode(error);
    return jsonError(
      code === "provider_auth_failed"
        ? "احراز هویت Provider معتبر نیست."
        : "ذخیره یا اعتبارسنجی Region ممکن نیست.",
      code === "provider_auth_failed" ? 409 : 400,
      { code },
    );
  }
}

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const idempotencyKey = readIdempotencyKey(request);
    if (!idempotencyKey) return jsonError("شناسه یکتای درخواست الزامی است.", 400);
    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return jsonError("Region معتبر نیست.", 400);
    const before = await prisma.providerRegionConfig.findUnique({ where: { id } });
    if (!before || before.provider !== InfrastructureProvider.ARVAN) {
      return jsonError("Region پیدا نشد.", 404);
    }
    const wantsEnabled = body.syncEnabled === true || body.saleEnabled === true;
    const validation = wantsEnabled
      ? await validateArvanRegion(before.regionCode)
      : { ok: true as const, code: "provider_region_disabled_by_admin" };
    if (wantsEnabled && !validation.ok) {
      return jsonError("Region از Provider تأیید نشد و فعال نشد.", 409, {
        code: validation.code,
      });
    }
    const meta = await readRequestMeta(request);
    const region = await prisma.$transaction(async (tx) => {
      const saved = await tx.providerRegionConfig.update({
        where: { id },
        data: {
          ...(typeof body.displayName === "string"
            ? { displayName: normalizeProviderRegionDisplayName(body.displayName) }
            : {}),
          ...(typeof body.syncEnabled === "boolean"
            ? { syncEnabled: body.syncEnabled }
            : {}),
          ...(typeof body.saleEnabled === "boolean"
            ? { saleEnabled: body.saleEnabled }
            : {}),
          ...(typeof body.sortOrder === "number" && Number.isSafeInteger(body.sortOrder)
            ? { sortOrder: body.sortOrder }
            : {}),
          lastValidatedAt: wantsEnabled ? new Date() : before.lastValidatedAt,
          lastValidationCode: validation.code,
          source: ProviderRegionConfigSource.ADMIN,
          updatedById: admin.id,
        },
      });
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.PROVIDER_REGION_UPDATE,
          entityType: "provider_region_config",
          entityId: id,
          beforeData: {
            displayName: before.displayName,
            syncEnabled: before.syncEnabled,
            saleEnabled: before.saleEnabled,
          },
          afterData: {
            displayName: saved.displayName,
            syncEnabled: saved.syncEnabled,
            saleEnabled: saved.saleEnabled,
            validationCode: saved.lastValidationCode,
          },
          idempotencyKey,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
      return saved;
    });
    return jsonOk({ region, validation });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof IdempotencyConflictError) {
      return jsonError("شناسه یکتا با درخواست قبلی تعارض دارد.", 409, {
        code: error.code,
      });
    }
    if (error instanceof SyntaxError) return jsonError("بدنه درخواست معتبر نیست.", 400);
    return jsonError("به‌روزرسانی Region ممکن نیست.", 400);
  }
}
