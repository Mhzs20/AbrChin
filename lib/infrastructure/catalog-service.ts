import {
  CatalogMappingStatus,
  DeliveryMode,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  ProviderCatalogStatus,
  ProviderSyncStatus,
  type ProviderCatalogItem,
  type Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";

import {
  READY_SERVER_PLAN_PREFIX,
  readyServerDescription,
  readyServerPlanCode,
  readyServerSortOrder,
  readyServerTitle,
  selectReadyServerImage,
} from "@/lib/cloud-servers/catalog";
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

async function materializeReadyServerPlans(
  tx: Prisma.TransactionClient,
  items: ProviderCatalogItem[],
  pricingConfig: { markupBasisPoints: number },
  syncedAt: Date,
) {
  await tx.infrastructurePlan.updateMany({
    where: {
      provider: InfrastructureProvider.PARSPACK,
      code: { startsWith: READY_SERVER_PLAN_PREFIX },
      active: true,
    },
    data: { active: false },
  });

  let readyPlanCount = 0;
  for (const item of items) {
    const imageCodes = Array.isArray(item.compatibleImageCodes)
      ? item.compatibleImageCodes.filter(
          (code): code is string => typeof code === "string",
        )
      : [];
    const imageCode = selectReadyServerImage(imageCodes);
    if (!imageCode) continue;

    const contract = normalizeProviderPriceContract({
      currencyCode: item.currencyCode,
      amountUnit: item.amountUnit,
    });
    const providerBasePriceRial =
      item.priceMonthlyAmount != null &&
      item.priceMonthlyAmount > 0n &&
      contract
        ? providerAmountToRial({
            scaledAmount: item.priceMonthlyAmount,
            scale: item.priceScale,
            contract,
          })
        : null;
    const finalPriceRial =
      providerBasePriceRial == null
        ? null
        : calculateFinalPriceRial(
            providerBasePriceRial,
            pricingConfig.markupBasisPoints,
          );
    const sellable =
      item.active &&
      item.available &&
      providerBasePriceRial != null &&
      finalPriceRial != null;
    const code = readyServerPlanCode(item.regionCode, item.sizeCode);
    const planData = {
      title: readyServerTitle(item),
      description: readyServerDescription({
        regionCode: item.regionCode,
        imageCode,
      }),
      provider: InfrastructureProvider.PARSPACK,
      regionCode: item.regionCode,
      sizeCode: item.sizeCode,
      imageCode,
      deliveryMode: DeliveryMode.MANAGED,
      vcpu: item.vcpu,
      ramGb: item.ramMb == null ? null : Math.ceil(item.ramMb / 1024),
      storageGb: item.diskGb,
      salePriceRial: finalPriceRial ?? 1n,
      renewalPriceRial: finalPriceRial ?? 1n,
      estimatedProviderCostRial: providerBasePriceRial ?? 1n,
      deliveryEstimateMinutes: 15,
      parchinIncluded: true,
      minimumParchinLevel: ParchinLevel.PARCHIN_START,
      active: sellable,
      sortOrder: readyServerSortOrder(item),
      catalogItemId: item.id,
      catalogMappingStatus: CatalogMappingStatus.MAPPED,
      catalogMappedAt: syncedAt,
    };

    await tx.infrastructurePlan.upsert({
      where: { code },
      update: planData,
      create: { code, ...planData },
    });
    if (sellable) readyPlanCount += 1;
  }

  return readyPlanCount;
}

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
    where: { provider: InfrastructureProvider.PARSPACK },
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

  const readyPlanCount = await materializeReadyServerPlans(
    tx,
    persistedItems,
    pricingConfig,
    syncedAt,
  );

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
    readyPlanCount,
    priceContractConfirmed: Boolean(contract),
  };
}

export async function refreshProviderCatalogForPricing(now = new Date()) {
  if (!isProviderConfigured()) {
    throw new WalletError(
      "quote_revalidation_failed",
      "بررسی قیمت و ظرفیت فعلی ممکن نیست.",
    );
  }
  try {
    return await withCatalogSyncLease(
      InfrastructureProvider.PARSPACK,
      "v1",
      async () => {
        const provider = createInfrastructureProvider();
        const catalog = await provider.syncCatalog();
        return prisma.$transaction(async (tx) => {
          const persisted = await persistProviderCatalog(tx, catalog, now);
          await tx.providerCatalogState.upsert({
        where: { provider: InfrastructureProvider.PARSPACK },
        update: {
          lastCatalogSync: now,
          syncRequestedAt: null,
          lastSyncStatus: ProviderSyncStatus.SUCCEEDED,
          regionCount: catalog.regions.length,
          sizeCount: catalog.sizes.length,
          imageCount: catalog.images.length,
          catalogItemCount: persisted.catalogItemCount,
          pricedItemCount: persisted.pricedItemCount,
          unavailableItemCount: persisted.unavailableItemCount,
          lastError: persisted.priceContractConfirmed
            ? null
            : "واحد و ارز قیمت Provider هنوز با قرارداد رسمی تأیید نشده است.",
        },
        create: {
          id: "parspack",
          provider: InfrastructureProvider.PARSPACK,
          lastCatalogSync: now,
          syncRequestedAt: null,
          lastSyncStatus: ProviderSyncStatus.SUCCEEDED,
          regionCount: catalog.regions.length,
          sizeCount: catalog.sizes.length,
          imageCount: catalog.images.length,
          catalogItemCount: persisted.catalogItemCount,
          pricedItemCount: persisted.pricedItemCount,
          unavailableItemCount: persisted.unavailableItemCount,
          lastError: persisted.priceContractConfirmed
            ? null
            : "واحد و ارز قیمت Provider هنوز با قرارداد رسمی تأیید نشده است.",
        },
          });
          return persisted;
        });
      },
    );
  } catch (error) {
    if (error instanceof WalletError) throw error;
    throw new WalletError(
      "quote_revalidation_failed",
      "بررسی قیمت و ظرفیت فعلی ممکن نیست.",
    );
  }
}
