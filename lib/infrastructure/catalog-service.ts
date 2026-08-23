import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ProviderCatalogStatus,
  type Prisma,
} from "@prisma/client";
import { createHash } from "node:crypto";

import type { ProviderCatalog } from "@/lib/infrastructure/types";
import {
  decimalToScaledInteger,
  DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
  normalizeProviderPriceContract,
  providerAmountToRial,
  PROVIDER_PRICE_SCALE,
} from "@/lib/pricing/provider-pricing";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
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
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        region: regionCode,
        externalPlanId: size.code,
      });

      return {
        provider: InfrastructureProvider.ARVAN,
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
        catalogVersion: `arvan:v1:${syncedAt.toISOString()}`,
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
  await tx.providerPricingConfig.upsert({
    where: { provider: InfrastructureProvider.ARVAN },
    update: {
      apiVersion: "v1",
      sourceMoneyUnit: contract?.amountUnit ?? null,
    },
    create: {
      id: "arvan",
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      sourceMoneyUnit: contract?.amountUnit ?? null,
      markupBasisPoints: DEFAULT_LAUNCH_MARKUP_BASIS_POINTS,
      enabled: false,
    },
  });
  await tx.productPricingConfig.upsert({
    where: {
      provider_apiVersion_productKind: {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      },
    },
    update: {},
    create: {
      provider: InfrastructureProvider.ARVAN,
      apiVersion: "v1",
      productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
      markupBasisPoints: 0,
      enabled: false,
    },
  });

  await tx.providerCatalogItem.updateMany({
    where: {
      provider: InfrastructureProvider.ARVAN,
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

  const [catalogItemCount, pricedItemCount, unavailableItemCount] = await Promise.all([
    tx.providerCatalogItem.count({
      where: { provider: InfrastructureProvider.ARVAN, active: true },
    }),
    tx.providerCatalogItem.count({
      where: {
        provider: InfrastructureProvider.ARVAN,
        active: true,
        priceMonthlyAmount: { gt: 0n },
        currencyCode: contract?.currencyCode ?? "__unconfirmed__",
        amountUnit: contract?.amountUnit ?? "__unconfirmed__",
      },
    }),
    tx.providerCatalogItem.count({
      where: {
        provider: InfrastructureProvider.ARVAN,
        OR: [{ active: false }, { available: false }],
      },
    }),
  ]);

  return {
    catalogItemCount,
    pricedItemCount,
    unavailableItemCount,
    mappedPlanCount: 0,
    unmappedPlanCount: 0,
    readyPlanCount: 0,
    priceContractConfirmed: Boolean(contract),
  };
}

export async function refreshProviderCatalogForPricing(now = new Date()) {
  void now;
  return refreshMultiProviderCatalog(InfrastructureProvider.ARVAN);
}
