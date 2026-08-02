import {
  CatalogMappingStatus,
  DeliveryMode,
  InfrastructureProductKind,
  InfrastructureProvider,
  ProviderCatalogStatus,
  ProviderSyncStatus,
  type Prisma,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import type { ProviderCatalog } from "@/lib/infrastructure/types";
import {
  calculateFinalPriceRial,
  decimalToScaledInteger,
  normalizeProviderPriceContract,
  providerAmountToRial,
  PROVIDER_PRICE_SCALE,
} from "@/lib/pricing/provider-pricing";
import { prisma } from "@/lib/db";
import { withCatalogSyncLease } from "@/lib/infrastructure/multi-provider-catalog-service";
import {
  createInfrastructureProvider,
  isProviderConfigured,
} from "@/lib/infrastructure/provider-factory";
import { WalletError } from "@/lib/wallet/errors";
import { catalogExternalKey } from "@/lib/infrastructure/provider-routing";
import type { InfrastructureProviderAdapter } from "@/lib/infrastructure/types";
import {
  ProviderCatalogSyncError,
  safeProviderSyncCode,
  safeProviderSyncMessage,
  type SafeProviderSyncCode,
} from "@/lib/infrastructure/catalog-sync-observability";

export const UNSCOPED_REGION_CODE = "__unscoped__";

type CatalogItemInput = {
  provider: InfrastructureProvider;
  apiVersion: string;
  productKind: InfrastructureProductKind;
  regionCode: string;
  sizeCode: string;
  externalPlanId: string;
  externalKey: string;
  sizeName: string;
  compatibleImageCodes: string[];
  vcpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
  transfer: string | null;
  available: boolean;
  status: ProviderCatalogStatus;
  priceHourlyAmount: bigint | null;
  priceMonthlyAmount: bigint | null;
  priceScale: number;
  currencyCode: string | null;
  amountUnit: string | null;
  providerHourlyPriceIrr: bigint | null;
  providerMonthlyPriceIrr: bigint | null;
  lastSyncedAt: Date;
  lastSeenAt: Date;
  rawUpdatedAt: Date | null;
  unavailableAt: Date | null;
  rawPayload: Prisma.InputJsonValue;
  payloadHash: string;
  catalogVersion: string;
};

function parseOptionalPrice(value?: string): bigint | null {
  if (value == null) return null;
  const parsed = decimalToScaledInteger(value);
  return parsed > 0n ? parsed : null;
}

function parseRawUpdatedAt(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildCatalogItems(
  catalog: ProviderCatalog,
  syncedAt = new Date(),
): CatalogItemInput[] {
  const contract = normalizeProviderPriceContract(catalog.priceContract);
  const regionByCode = new Map(catalog.regions.map((region) => [region.code, region]));

  return catalog.sizes.flatMap((size) => {
    const explicitRegions = new Set(
      [
        ...(size.regionCodes ?? []),
        ...(size.regionCode ? [size.regionCode] : []),
        ...catalog.regions
          .filter((region) => region.sizeCodes?.includes(size.code))
          .map((region) => region.code),
      ].filter(Boolean),
    );
    const regionCodes =
      explicitRegions.size > 0 ? [...explicitRegions] : [UNSCOPED_REGION_CODE];

    return regionCodes.map((regionCode) => {
      const region = regionByCode.get(regionCode);
      const compatibleImages = catalog.images
        .filter((image) => {
          const status = image.status?.toLowerCase();
          if (status && !["available", "active", "ready"].includes(status)) return false;
          if (image.minDiskGb != null && size.diskGb != null && image.minDiskGb > size.diskGb) {
            return false;
          }
          return (
            !image.regionCodes?.length ||
            regionCode === UNSCOPED_REGION_CODE ||
            image.regionCodes.includes(regionCode)
          );
        })
        .map((image) => image.code)
        .sort();
      const available =
        regionCode !== UNSCOPED_REGION_CODE &&
        size.available !== false &&
        region?.available !== false;
      const priceHourlyAmount = parseOptionalPrice(size.priceHourly);
      const priceMonthlyAmount = parseOptionalPrice(size.priceMonthly);
      const toRial = (amount: bigint | null) =>
        amount != null && contract
          ? providerAmountToRial({
              scaledAmount: amount,
              scale: PROVIDER_PRICE_SCALE,
              contract,
            })
          : null;
      const providerHourlyPriceIrr = toRial(priceHourlyAmount);
      const providerMonthlyPriceIrr = toRial(priceMonthlyAmount);
      const status =
        !available
          ? ProviderCatalogStatus.UNAVAILABLE
          : providerMonthlyPriceIrr == null ||
              providerMonthlyPriceIrr <= 0n
            ? ProviderCatalogStatus.INVALID_PRICE
            : ProviderCatalogStatus.ACTIVE;
      const rawPayload = { regionCode, ...size };
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(rawPayload))
        .digest("hex");
      const externalKey = catalogExternalKey({
        provider: InfrastructureProvider.PARSPACK,
        apiVersion: "v1",
        region: regionCode,
        externalPlanId: size.code,
      });

      return {
        provider: InfrastructureProvider.PARSPACK,
        apiVersion: "v1",
        productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
        regionCode,
        sizeCode: size.code,
        externalPlanId: size.code,
        externalKey,
        sizeName: size.name,
        compatibleImageCodes: compatibleImages,
        vcpu: size.vcpu == null ? null : Math.trunc(size.vcpu),
        ramMb: size.memoryMb == null ? null : Math.trunc(size.memoryMb),
        diskGb: size.diskGb == null ? null : Math.trunc(size.diskGb),
        transfer: size.transfer == null ? null : String(size.transfer),
        available: status === ProviderCatalogStatus.ACTIVE,
        status,
        priceHourlyAmount,
        priceMonthlyAmount,
        priceScale: PROVIDER_PRICE_SCALE,
        currencyCode: contract?.currencyCode ?? null,
        amountUnit: contract?.amountUnit ?? null,
        providerHourlyPriceIrr,
        providerMonthlyPriceIrr,
        lastSyncedAt: syncedAt,
        lastSeenAt: syncedAt,
        rawUpdatedAt: parseRawUpdatedAt(size.rawUpdatedAt),
        unavailableAt:
          status === ProviderCatalogStatus.ACTIVE ? null : syncedAt,
        rawPayload: rawPayload as Prisma.InputJsonValue,
        payloadHash,
        catalogVersion: `parspack:v1:${syncedAt.toISOString()}`,
      };
    });
  });
}

export async function persistProviderCatalog(
  tx: Prisma.TransactionClient,
  catalog: ProviderCatalog,
  syncedAt = new Date(),
) {
  const items = buildCatalogItems(catalog, syncedAt);
  const contract = normalizeProviderPriceContract(catalog.priceContract);
  const pricingConfig = await tx.providerPricingConfig.upsert({
    where: { provider: InfrastructureProvider.PARSPACK },
    update: {
      apiVersion: "v1",
      sourceMoneyUnit: contract?.amountUnit ?? null,
    },
    create: {
      id: "parspack",
      provider: InfrastructureProvider.PARSPACK,
      apiVersion: "v1",
      sourceMoneyUnit: contract?.amountUnit ?? null,
      markupBasisPoints: 0,
    },
  });
  await tx.productPricingConfig.upsert({
    where: {
      provider_apiVersion_productKind: {
        provider: InfrastructureProvider.PARSPACK,
        apiVersion: "v1",
        productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      },
    },
    update: {},
    create: {
      provider: InfrastructureProvider.PARSPACK,
      apiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      markupBasisPoints: 0,
    },
  });

  await tx.providerCatalogItem.updateMany({
    where: {
      provider: InfrastructureProvider.PARSPACK,
      available: true,
    },
    data: {
      available: false,
      status: ProviderCatalogStatus.UNAVAILABLE,
      unavailableAt: syncedAt,
    },
  });

  for (const item of items) {
    await tx.providerCatalogItem.upsert({
      where: {
        provider_apiVersion_regionCode_externalPlanId: {
          provider: item.provider,
          apiVersion: item.apiVersion,
          regionCode: item.regionCode,
          externalPlanId: item.externalPlanId,
        },
      },
      update: {
        apiVersion: item.apiVersion,
        productKind: item.productKind,
        externalPlanId: item.externalPlanId,
        externalKey: item.externalKey,
        sizeName: item.sizeName,
        compatibleImageCodes: item.compatibleImageCodes,
        vcpu: item.vcpu,
        ramMb: item.ramMb,
        diskGb: item.diskGb,
        transfer: item.transfer,
        available: item.available,
        active: true,
        status: item.status,
        priceHourlyAmount: item.priceHourlyAmount,
        priceMonthlyAmount: item.priceMonthlyAmount,
        priceScale: item.priceScale,
        currencyCode: item.currencyCode,
        amountUnit: item.amountUnit,
        providerHourlyPriceIrr: item.providerHourlyPriceIrr,
        providerMonthlyPriceIrr: item.providerMonthlyPriceIrr,
        lastSyncedAt: item.lastSyncedAt,
        lastSeenAt: item.lastSeenAt,
        rawUpdatedAt: item.rawUpdatedAt,
        unavailableAt: item.unavailableAt,
        rawPayload: item.rawPayload,
        payloadHash: item.payloadHash,
        catalogVersion: item.catalogVersion,
      },
      create: item,
    });
  }

  const plans = await tx.infrastructurePlan.findMany({
    where: {
      provider: InfrastructureProvider.PARSPACK,
      offerSource: "API_CATALOG",
    },
  });
  const persistedItems = await tx.providerCatalogItem.findMany({
    where: { provider: InfrastructureProvider.PARSPACK },
  });
  const itemByExactKey = new Map(
    persistedItems.map((item) => [`${item.regionCode}\u0000${item.sizeCode}`, item]),
  );
  let mappedPlanCount = 0;
  let unmappedPlanCount = 0;

  for (const plan of plans) {
    const item = itemByExactKey.get(`${plan.regionCode}\u0000${plan.sizeCode}`);
    const imageCodes = Array.isArray(item?.compatibleImageCodes)
      ? item.compatibleImageCodes.filter((code): code is string => typeof code === "string")
      : [];
    if (!item || !imageCodes.includes(plan.imageCode)) {
      await tx.infrastructurePlan.update({
        where: { id: plan.id },
        data: {
          active: false,
          catalogItemId: null,
          catalogMappingStatus: CatalogMappingStatus.UNMAPPED,
          catalogMappedAt: null,
        },
      });
      unmappedPlanCount += 1;
      continue;
    }

    const itemContract = normalizeProviderPriceContract({
      currencyCode: item.currencyCode,
      amountUnit: item.amountUnit,
    });
    const basePriceRial =
      item.priceMonthlyAmount != null && item.priceMonthlyAmount > 0n && itemContract
        ? providerAmountToRial({
            scaledAmount: item.priceMonthlyAmount,
            scale: item.priceScale,
            contract: itemContract,
          })
        : null;
    const finalPriceRial =
      basePriceRial == null
        ? null
        : calculateFinalPriceRial(basePriceRial, pricingConfig.markupBasisPoints);
    await tx.infrastructurePlan.update({
      where: { id: plan.id },
      data: {
        catalogItemId: item.id,
        catalogMappingStatus: CatalogMappingStatus.MAPPED,
        catalogMappedAt: syncedAt,
        vcpu: item.vcpu,
        ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
        storageGb: item.diskGb,
        ...(basePriceRial != null && finalPriceRial != null
          ? {
              estimatedProviderCostRial: basePriceRial,
              salePriceRial: finalPriceRial,
              renewalPriceRial: finalPriceRial,
            }
          : {}),
      },
    });
    mappedPlanCount += 1;
  }

  await tx.infrastructurePlan.updateMany({
    where: {
      provider: InfrastructureProvider.PARSPACK,
      active: true,
      OR: [
        { deliveryMode: DeliveryMode.RAW },
        { parchinIncluded: false },
      ],
    },
    data: { active: false },
  });

  const [catalogItemCount, pricedItemCount, unavailableItemCount] = await Promise.all([
    tx.providerCatalogItem.count({
      where: { provider: InfrastructureProvider.PARSPACK, active: true },
    }),
    tx.providerCatalogItem.count({
      where: {
        provider: InfrastructureProvider.PARSPACK,
        active: true,
        priceMonthlyAmount: { gt: 0n },
        currencyCode: contract?.currencyCode ?? "__unconfirmed__",
        amountUnit: contract?.amountUnit ?? "__unconfirmed__",
      },
    }),
    tx.providerCatalogItem.count({
      where: {
        provider: InfrastructureProvider.PARSPACK,
        OR: [{ active: false }, { available: false }],
      },
    }),
  ]);

  return {
    catalogItemCount,
    pricedItemCount,
    unavailableItemCount,
    mappedPlanCount,
    unmappedPlanCount,
    readyPlanCount: 0,
    priceContractConfirmed: Boolean(contract),
  };
}

async function recordParsPackSyncFailure(input: {
  syncRunId: string;
  attemptedAt: Date;
  startedMs: number;
  code: SafeProviderSyncCode;
}) {
  const finishedAt = new Date();
  const durationMs = Math.max(Date.now() - input.startedMs, 0);
  const message = safeProviderSyncMessage(input.code);
  await prisma.$transaction([
    prisma.providerCatalogSyncRun.update({
      where: { id: input.syncRunId },
      data: {
        status: ProviderSyncStatus.FAILED,
        failedRegions: 1,
        report: {
          error: { code: input.code, message },
        },
        finishedAt,
        durationMs,
      },
    }),
    prisma.providerCatalogState.upsert({
      where: { provider: InfrastructureProvider.PARSPACK },
      update: {
        apiVersion: "v1",
        lastCatalogSync: input.attemptedAt,
        lastSyncDurationMs: durationMs,
        lastSyncStatus: ProviderSyncStatus.FAILED,
        syncRequestedAt: null,
        lastError: message,
        regionErrors: [{ code: input.code, message }],
      },
      create: {
        id: "parspack-v1",
        provider: InfrastructureProvider.PARSPACK,
        apiVersion: "v1",
        lastCatalogSync: input.attemptedAt,
        lastSyncDurationMs: durationMs,
        lastSyncStatus: ProviderSyncStatus.FAILED,
        lastError: message,
        regionErrors: [{ code: input.code, message }],
      },
    }),
  ]);
}

export async function syncParsPackCatalog(
  provider: InfrastructureProviderAdapter,
  now = new Date(),
) {
  if (provider.provider !== InfrastructureProvider.PARSPACK) {
    throw new Error("provider_route_mismatch");
  }
  return withCatalogSyncLease(
    InfrastructureProvider.PARSPACK,
    "v1",
    async () => {
      const startedMs = Date.now();
      const catalogVersion = `parspack:v1:${now.toISOString()}`;
      const syncRun = await prisma.providerCatalogSyncRun.create({
        data: {
          id: randomUUID(),
          provider: InfrastructureProvider.PARSPACK,
          apiVersion: "v1",
          status: ProviderSyncStatus.RUNNING,
          catalogVersion,
        },
      });

      let catalog: ProviderCatalog;
      try {
        catalog = await provider.syncCatalog();
      } catch (error) {
        const code = safeProviderSyncCode(error);
        try {
          await recordParsPackSyncFailure({
            syncRunId: syncRun.id,
            attemptedAt: now,
            startedMs,
            code,
          });
        } catch {
          throw new ProviderCatalogSyncError({
            provider: InfrastructureProvider.PARSPACK,
            apiVersion: "v1",
            operation: "catalog_sync",
            code: "provider_persistence_failed",
          });
        }
        throw new ProviderCatalogSyncError({
          provider: InfrastructureProvider.PARSPACK,
          apiVersion: "v1",
          operation: "catalog_sync",
          code,
        });
      }

      try {
        return await prisma.$transaction(async (tx) => {
          const persisted = await persistProviderCatalog(tx, catalog, now);
          const durationMs = Math.max(Date.now() - startedMs, 0);
          const priceWarning = persisted.priceContractConfirmed
            ? null
            : "واحد و ارز قیمت Provider هنوز با قرارداد رسمی تأیید نشده است.";
          await tx.providerCatalogState.upsert({
            where: { provider: InfrastructureProvider.PARSPACK },
            update: {
              apiVersion: "v1",
              lastCatalogSync: now,
              syncRequestedAt: null,
              lastSyncStatus: ProviderSyncStatus.SUCCEEDED,
              lastSyncDurationMs: durationMs,
              catalogVersion,
              regionCount: catalog.regions.length,
              sizeCount: catalog.sizes.length,
              imageCount: catalog.images.length,
              catalogItemCount: persisted.catalogItemCount,
              pricedItemCount: persisted.pricedItemCount,
              unavailableItemCount: persisted.unavailableItemCount,
              regionErrors: [],
              lastError: priceWarning,
            },
            create: {
              id: "parspack-v1",
              provider: InfrastructureProvider.PARSPACK,
              apiVersion: "v1",
              lastCatalogSync: now,
              lastSyncStatus: ProviderSyncStatus.SUCCEEDED,
              lastSyncDurationMs: durationMs,
              catalogVersion,
              regionCount: catalog.regions.length,
              sizeCount: catalog.sizes.length,
              imageCount: catalog.images.length,
              catalogItemCount: persisted.catalogItemCount,
              pricedItemCount: persisted.pricedItemCount,
              unavailableItemCount: persisted.unavailableItemCount,
              regionErrors: [],
              lastError: priceWarning,
            },
          });
          await tx.providerCatalogSyncRun.update({
            where: { id: syncRun.id },
            data: {
              status: ProviderSyncStatus.SUCCEEDED,
              regionCount: catalog.regions.length,
              successfulRegions: catalog.regions.length,
              planCount: catalog.sizes.length,
              imageCount: catalog.images.length,
              report: {
                priceContractConfirmed: persisted.priceContractConfirmed,
                readyPlanCount: persisted.readyPlanCount,
              },
              finishedAt: new Date(),
              durationMs,
            },
          });
          return persisted;
        });
      } catch {
        try {
          await recordParsPackSyncFailure({
            syncRunId: syncRun.id,
            attemptedAt: now,
            startedMs,
            code: "provider_persistence_failed",
          });
        } catch {
          // The safe persistence error below is still the only information
          // allowed to cross the catalog boundary.
        }
        throw new ProviderCatalogSyncError({
          provider: InfrastructureProvider.PARSPACK,
          apiVersion: "v1",
          operation: "catalog_sync",
          code: "provider_persistence_failed",
        });
      }
    },
  );
}

export async function refreshProviderCatalogForPricing(now = new Date()) {
  if (!isProviderConfigured()) {
    throw new WalletError(
      "quote_revalidation_failed",
      "بررسی قیمت و ظرفیت فعلی ممکن نیست.",
    );
  }
  return syncParsPackCatalog(createInfrastructureProvider(), now);
}
