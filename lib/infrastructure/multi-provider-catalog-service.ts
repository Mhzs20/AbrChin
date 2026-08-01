import { createHash, randomUUID } from "node:crypto";

import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ProviderCatalogAssetKind,
  ProviderCatalogStatus,
  ProviderSyncStatus,
  type Prisma,
} from "@prisma/client";

import type {
  CloudProviderAdapter,
  ProviderImage,
  ProviderNetwork,
  ProviderPlan,
  ProviderSecurity,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { prisma } from "@/lib/db";
import {
  createCloudProviderAdapter,
  isCloudProviderConfigured,
} from "@/lib/infrastructure/provider-factory";
import {
  catalogExternalKey,
  resolveProviderRoute,
} from "@/lib/infrastructure/provider-routing";
import { listProviderSyncRegionCodes } from "@/lib/infrastructure/provider-region-config";

const CATALOG_SYNC_LEASE_MS = 10 * 60 * 1000;

export function catalogRamMbToPlanRamGb(
  ramMb: number | null,
): number | null {
  if (ramMb == null) return null;
  if (!Number.isInteger(ramMb) || ramMb <= 0 || ramMb % 1024 !== 0) {
    throw new Error("invalid_catalog_ram_mb");
  }
  return ramMb / 1024;
}

type RegionFailure = {
  region: string;
  code: string;
  message: string;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function providerPayloadHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function safeRegionError(error: unknown): { code: string; message: string } {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code.slice(0, 80)
      : "provider_sync_failed";
  return {
    code,
    message: "همگام‌سازی این Region کامل نشد؛ دادهٔ سالم قبلی حفظ شد.",
  };
}

function catalogStatus(plan: ProviderPlan): ProviderCatalogStatus {
  if (
    !plan.resourceContractValid ||
    plan.vcpu == null ||
    plan.vcpu <= 0 ||
    plan.ramMb == null ||
    plan.ramMb <= 0 ||
    plan.diskGb == null ||
    plan.diskGb <= 0
  ) {
    return ProviderCatalogStatus.INVALID_RESOURCE;
  }
  if (!plan.priceMonthlyIrr || plan.priceMonthlyIrr <= 0n) {
    return ProviderCatalogStatus.INVALID_PRICE;
  }
  return plan.available
    ? ProviderCatalogStatus.ACTIVE
    : ProviderCatalogStatus.UNAVAILABLE;
}

function compatibleImages(
  plan: ProviderPlan,
  images: ProviderImage[],
): ProviderImage[] {
  return images.filter(
    (image) =>
      image.available &&
      (image.minDiskGb == null ||
        plan.diskGb == null ||
        image.minDiskGb <= plan.diskGb) &&
      (image.minRamMb == null ||
        plan.ramMb == null ||
        image.minRamMb <= plan.ramMb),
  );
}

async function upsertAsset(
  tx: Prisma.TransactionClient,
  input: {
    provider: InfrastructureProvider;
    apiVersion: string;
    region: string;
    kind: ProviderCatalogAssetKind;
    asset: ProviderImage | ProviderNetwork | ProviderSecurity;
    syncedAt: Date;
  },
) {
  const rawPayload = input.asset.rawPayload;
  await tx.providerCatalogAsset.upsert({
    where: {
      provider_apiVersion_regionCode_kind_externalId: {
        provider: input.provider,
        apiVersion: input.apiVersion,
        regionCode: input.region,
        kind: input.kind,
        externalId: input.asset.externalId,
      },
    },
    update: {
      name: input.asset.name,
      status: input.asset.available
        ? ProviderCatalogStatus.ACTIVE
        : ProviderCatalogStatus.UNAVAILABLE,
      available: input.asset.available,
      isDefault:
        "isDefault" in input.asset &&
        input.asset.isDefault === true,
      lastSeenAt: input.syncedAt,
      lastSyncedAt: input.syncedAt,
      rawUpdatedAt: input.asset.rawUpdatedAt,
      rawPayload: jsonValue(rawPayload),
      payloadHash: providerPayloadHash(rawPayload),
    },
    create: {
      id: randomUUID(),
      provider: input.provider,
      apiVersion: input.apiVersion,
      regionCode: input.region,
      kind: input.kind,
      externalId: input.asset.externalId,
      name: input.asset.name,
      status: input.asset.available
        ? ProviderCatalogStatus.ACTIVE
        : ProviderCatalogStatus.UNAVAILABLE,
      available: input.asset.available,
      isDefault:
        "isDefault" in input.asset &&
        input.asset.isDefault === true,
      lastSeenAt: input.syncedAt,
      lastSyncedAt: input.syncedAt,
      rawUpdatedAt: input.asset.rawUpdatedAt,
      rawPayload: jsonValue(rawPayload),
      payloadHash: providerPayloadHash(rawPayload),
    },
  });
}

async function persistSuccessfulRegion(input: {
  adapter: CloudProviderAdapter;
  productKind: InfrastructureProductKind;
  region: {
    code: string;
    name: string;
    available: boolean;
    rawPayload: Record<string, unknown>;
    providerRequestId?: string;
  };
  plans: ProviderPlan[];
  images: ProviderImage[];
  networks: ProviderNetwork[];
  securities: ProviderSecurity[];
  syncedAt: Date;
  catalogVersion: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.providerCatalogRegionState.upsert({
      where: {
        provider_apiVersion_regionCode: {
          provider: input.adapter.provider,
          apiVersion: input.adapter.apiVersion,
          regionCode: input.region.code,
        },
      },
      update: {
        available: input.region.available,
        status: input.region.available
          ? ProviderCatalogStatus.ACTIVE
          : ProviderCatalogStatus.UNAVAILABLE,
        lastSeenAt: input.syncedAt,
        lastSyncedAt: input.syncedAt,
        lastSuccessfulSyncAt: input.syncedAt,
        lastError: null,
        providerRequestId: input.region.providerRequestId ?? null,
        rawPayload: jsonValue(input.region.rawPayload),
      },
      create: {
        id: randomUUID(),
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        regionCode: input.region.code,
        available: input.region.available,
        status: input.region.available
          ? ProviderCatalogStatus.ACTIVE
          : ProviderCatalogStatus.UNAVAILABLE,
        lastSeenAt: input.syncedAt,
        lastSyncedAt: input.syncedAt,
        lastSuccessfulSyncAt: input.syncedAt,
        providerRequestId: input.region.providerRequestId ?? null,
        rawPayload: jsonValue(input.region.rawPayload),
      },
    });

    for (const image of input.images) {
      await upsertAsset(tx, {
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        region: input.region.code,
        kind: ProviderCatalogAssetKind.IMAGE,
        asset: image,
        syncedAt: input.syncedAt,
      });
    }
    for (const network of input.networks) {
      await upsertAsset(tx, {
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        region: input.region.code,
        kind: ProviderCatalogAssetKind.NETWORK,
        asset: network,
        syncedAt: input.syncedAt,
      });
    }
    for (const security of input.securities) {
      await upsertAsset(tx, {
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        region: input.region.code,
        kind: ProviderCatalogAssetKind.SECURITY,
        asset: security,
        syncedAt: input.syncedAt,
      });
    }

    for (const plan of input.plans) {
      const key = catalogExternalKey({
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        region: input.region.code,
        externalPlanId: plan.externalPlanId,
      });
      const images = compatibleImages(plan, input.images);
      const status = input.region.available
        ? catalogStatus(plan)
        : ProviderCatalogStatus.UNAVAILABLE;
      await tx.providerCatalogItem.upsert({
        where: {
          provider_apiVersion_regionCode_externalPlanId: {
            provider: input.adapter.provider,
            apiVersion: input.adapter.apiVersion,
            regionCode: input.region.code,
            externalPlanId: plan.externalPlanId,
          },
        },
        update: {
          // If an Admin entered a provider plan while the API was unavailable,
          // a later authoritative response promotes the same regional identity
          // back to provider-owned data without touching its curated Plan.
          source: "API_CATALOG",
          manualAvailableUnits: null,
          manualPriceValidUntil: null,
          manualLastVerifiedAt: null,
          manualUpdatedById: null,
          externalKey: key,
          productKind: input.productKind,
          sizeCode: plan.externalPlanId,
          sizeName: plan.name,
          compatibleImageCodes: images.map((image) => image.externalId),
          vcpu: plan.vcpu,
          ramMb: plan.ramMb,
          diskGb: plan.diskGb,
          available:
            status === ProviderCatalogStatus.ACTIVE && images.length > 0,
          active: true,
          status:
            status === ProviderCatalogStatus.ACTIVE && images.length === 0
              ? ProviderCatalogStatus.UNAVAILABLE
              : status,
          priceHourlyAmount: plan.priceHourlyIrr,
          priceMonthlyAmount: plan.priceMonthlyIrr,
          priceScale: 0,
          currencyCode: "IRR",
          amountUnit: "RIAL",
          providerHourlyPriceIrr: plan.priceHourlyIrr,
          providerMonthlyPriceIrr: plan.priceMonthlyIrr,
          lastSeenAt: input.syncedAt,
          lastSyncedAt: input.syncedAt,
          rawUpdatedAt: plan.rawUpdatedAt,
          rawPayload: jsonValue(plan.rawPayload),
          payloadHash: providerPayloadHash(plan.rawPayload),
          catalogVersion: input.catalogVersion,
          unavailableAt:
            status === ProviderCatalogStatus.ACTIVE && images.length > 0
              ? null
              : input.syncedAt,
        },
        create: {
          id: randomUUID(),
          provider: input.adapter.provider,
          apiVersion: input.adapter.apiVersion,
          productKind: input.productKind,
          regionCode: input.region.code,
          sizeCode: plan.externalPlanId,
          externalPlanId: plan.externalPlanId,
          externalKey: key,
          sizeName: plan.name,
          compatibleImageCodes: images.map((image) => image.externalId),
          vcpu: plan.vcpu,
          ramMb: plan.ramMb,
          diskGb: plan.diskGb,
          available:
            status === ProviderCatalogStatus.ACTIVE && images.length > 0,
          active: true,
          status:
            status === ProviderCatalogStatus.ACTIVE && images.length === 0
              ? ProviderCatalogStatus.UNAVAILABLE
              : status,
          priceHourlyAmount: plan.priceHourlyIrr,
          priceMonthlyAmount: plan.priceMonthlyIrr,
          priceScale: 0,
          currencyCode: "IRR",
          amountUnit: "RIAL",
          providerHourlyPriceIrr: plan.priceHourlyIrr,
          providerMonthlyPriceIrr: plan.priceMonthlyIrr,
          lastSeenAt: input.syncedAt,
          lastSyncedAt: input.syncedAt,
          rawUpdatedAt: plan.rawUpdatedAt,
          rawPayload: jsonValue(plan.rawPayload),
          payloadHash: providerPayloadHash(plan.rawPayload),
          catalogVersion: input.catalogVersion,
          unavailableAt:
            status === ProviderCatalogStatus.ACTIVE && images.length > 0
              ? null
              : input.syncedAt,
        },
      });
    }

    // Only a fully successful Region may make unseen records stale. A failed
    // Region never damages its last known-good catalog.
    await tx.providerCatalogItem.updateMany({
      where: {
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        regionCode: input.region.code,
        source: "API_CATALOG",
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: input.syncedAt } }],
        status: { not: ProviderCatalogStatus.DISABLED },
      },
      data: {
        status: ProviderCatalogStatus.STALE,
        available: false,
        unavailableAt: input.syncedAt,
      },
    });
    await tx.providerCatalogAsset.updateMany({
      where: {
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        regionCode: input.region.code,
        lastSeenAt: { lt: input.syncedAt },
        status: { not: ProviderCatalogStatus.DISABLED },
      },
      data: {
        status: ProviderCatalogStatus.STALE,
        available: false,
      },
    });

    const items = await tx.providerCatalogItem.findMany({
      where: {
        provider: input.adapter.provider,
        apiVersion: input.adapter.apiVersion,
        regionCode: input.region.code,
        source: "API_CATALOG",
      },
    });
    // Provider sync only owns raw catalog data. Public product publication is
    // an explicit Admin decision and must never be created or overwritten by
    // a catalog refresh.
    return items.length;
  });
}

async function syncMultiProviderCatalogUnlocked(
  adapter: CloudProviderAdapter,
  now = new Date(),
) {
  const route =
    adapter.provider === InfrastructureProvider.ARVAN
      ? resolveProviderRoute(InfrastructureProductKind.CLOUD_SERVER)
      : resolveProviderRoute(InfrastructureProductKind.READY_INSTANT_SERVER);
  if (route.apiVersion !== adapter.apiVersion) {
    throw new Error("provider_api_version_mismatch");
  }
  const startedMs = Date.now();
  const catalogVersion = `${adapter.provider.toLowerCase()}:${adapter.apiVersion}:${now.toISOString()}`;
  const syncRun = await prisma.providerCatalogSyncRun.create({
    data: {
      id: randomUUID(),
      provider: adapter.provider,
      apiVersion: adapter.apiVersion,
      status: ProviderSyncStatus.RUNNING,
      catalogVersion,
    },
  });

  let regions;
  try {
    regions = await adapter.syncRegions();
  } catch (error) {
    const safe = safeRegionError(error);
    await prisma.$transaction([
      prisma.providerCatalogSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: ProviderSyncStatus.FAILED,
          report: jsonValue({ root: safe }),
          finishedAt: new Date(),
          durationMs: Date.now() - startedMs,
        },
      }),
      prisma.providerCatalogState.upsert({
        where: { provider: adapter.provider },
        update: {
          apiVersion: adapter.apiVersion,
          lastCatalogSync: now,
          lastSyncStatus: ProviderSyncStatus.FAILED,
          lastSyncDurationMs: Date.now() - startedMs,
          lastError: safe.message,
        },
        create: {
          id: `${adapter.provider.toLowerCase()}-${adapter.apiVersion}`,
          provider: adapter.provider,
          apiVersion: adapter.apiVersion,
          lastCatalogSync: now,
          lastSyncStatus: ProviderSyncStatus.FAILED,
          lastSyncDurationMs: Date.now() - startedMs,
          lastError: safe.message,
        },
      }),
    ]);
    throw error;
  }

  const failures: RegionFailure[] = [];
  let successfulRegions = 0;
  let planCount = 0;
  let imageCount = 0;
  let networkCount = 0;
  let securityCount = 0;
  let lastProviderRequestId =
    regions.find((region) => region.providerRequestId)?.providerRequestId ??
    null;

  for (const region of regions) {
    const regionStarted = Date.now();
    try {
      const [plans, images, networks, securities] = await Promise.all([
        adapter.syncPlans(region.code),
        adapter.syncImages(region.code),
        adapter.syncNetworks(region.code),
        adapter.syncSecurity(region.code),
      ]);
      const regionRequestId =
        [...securities, ...networks, ...images, ...plans]
          .reverse()
          .find((item) => item.providerRequestId)?.providerRequestId ??
        region.providerRequestId ??
        null;
      if (regionRequestId) lastProviderRequestId = regionRequestId;
      await persistSuccessfulRegion({
        adapter,
        productKind: route.productKind,
        region: {
          ...region,
          ...(regionRequestId
            ? { providerRequestId: regionRequestId }
            : {}),
        },
        plans,
        images,
        networks,
        securities,
        syncedAt: now,
        catalogVersion,
      });
      successfulRegions += 1;
      planCount += plans.length;
      imageCount += images.length;
      networkCount += networks.length;
      securityCount += securities.length;
      await prisma.providerCatalogRegionState.update({
        where: {
          provider_apiVersion_regionCode: {
            provider: adapter.provider,
            apiVersion: adapter.apiVersion,
            regionCode: region.code,
          },
        },
        data: { syncDurationMs: Date.now() - regionStarted },
      });
    } catch (error) {
      const safe = safeRegionError(error);
      failures.push({ region: region.code, ...safe });
      await prisma.providerCatalogRegionState.upsert({
        where: {
          provider_apiVersion_regionCode: {
            provider: adapter.provider,
            apiVersion: adapter.apiVersion,
            regionCode: region.code,
          },
        },
        update: {
          lastSyncedAt: now,
          lastError: safe.message,
          syncDurationMs: Date.now() - regionStarted,
        },
        create: {
          id: randomUUID(),
          provider: adapter.provider,
          apiVersion: adapter.apiVersion,
          regionCode: region.code,
          lastSyncedAt: now,
          lastError: safe.message,
          syncDurationMs: Date.now() - regionStarted,
          status: ProviderCatalogStatus.STALE,
          available: false,
        },
      });
    }
  }

  const status =
    failures.length === 0
      ? ProviderSyncStatus.SUCCEEDED
      : successfulRegions > 0
        ? ProviderSyncStatus.PARTIAL
        : ProviderSyncStatus.FAILED;
  const [
    catalogItemCount,
    pricedItemCount,
    unavailableItemCount,
    staleItemCount,
    invalidPriceCount,
    invalidResourceCount,
  ] = await Promise.all([
    prisma.providerCatalogItem.count({
      where: { provider: adapter.provider, apiVersion: adapter.apiVersion },
    }),
    prisma.providerCatalogItem.count({
      where: {
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        status: ProviderCatalogStatus.ACTIVE,
        providerMonthlyPriceIrr: { gt: 0n },
      },
    }),
    prisma.providerCatalogItem.count({
      where: {
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        status: ProviderCatalogStatus.UNAVAILABLE,
      },
    }),
    prisma.providerCatalogItem.count({
      where: {
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        status: ProviderCatalogStatus.STALE,
      },
    }),
    prisma.providerCatalogItem.count({
      where: {
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        status: ProviderCatalogStatus.INVALID_PRICE,
      },
    }),
    prisma.providerCatalogItem.count({
      where: {
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        status: ProviderCatalogStatus.INVALID_RESOURCE,
      },
    }),
  ]);
  const durationMs = Date.now() - startedMs;
  await prisma.$transaction([
    prisma.providerCatalogSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status,
        regionCount: regions.length,
        successfulRegions,
        failedRegions: failures.length,
        planCount,
        imageCount,
        networkCount,
        securityCount,
        report: jsonValue({ failures }),
        finishedAt: new Date(),
        durationMs,
      },
    }),
    prisma.providerCatalogState.upsert({
      where: { provider: adapter.provider },
      update: {
        apiVersion: adapter.apiVersion,
        lastCatalogSync: now,
        regionCount: regions.length,
        sizeCount: planCount,
        imageCount,
        catalogItemCount,
        pricedItemCount,
        unavailableItemCount,
        staleItemCount,
        invalidPriceCount,
        invalidResourceCount,
        networkCount,
        securityCount,
        lastSyncDurationMs: durationMs,
        lastSyncStatus: status,
        catalogVersion,
        syncRequestedAt: null,
        regionErrors: jsonValue(failures),
        lastProviderRequestId,
        lastError:
          failures.length > 0
            ? `${failures.length.toLocaleString("fa-IR")} Region کامل Sync نشد.`
            : null,
      },
      create: {
        id: `${adapter.provider.toLowerCase()}-${adapter.apiVersion}`,
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        lastCatalogSync: now,
        regionCount: regions.length,
        sizeCount: planCount,
        imageCount,
        catalogItemCount,
        pricedItemCount,
        unavailableItemCount,
        staleItemCount,
        invalidPriceCount,
        invalidResourceCount,
        networkCount,
        securityCount,
        lastSyncDurationMs: durationMs,
        lastSyncStatus: status,
        catalogVersion,
        regionErrors: jsonValue(failures),
        lastProviderRequestId,
        lastError:
          failures.length > 0
            ? `${failures.length.toLocaleString("fa-IR")} Region کامل Sync نشد.`
            : null,
      },
    }),
    prisma.providerPricingConfig.upsert({
      where: { provider: adapter.provider },
      update: {
        apiVersion: adapter.apiVersion,
        sourceMoneyUnit:
          adapter.provider === InfrastructureProvider.ARVAN ? "IRR" : undefined,
      },
      create: {
        id: `${adapter.provider.toLowerCase()}-${adapter.apiVersion}`,
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        sourceMoneyUnit:
          adapter.provider === InfrastructureProvider.ARVAN ? "IRR" : null,
        markupBasisPoints: 0,
      },
    }),
    prisma.productPricingConfig.upsert({
      where: {
        provider_apiVersion_productKind: {
          provider: adapter.provider,
          apiVersion: adapter.apiVersion,
          productKind: route.productKind,
        },
      },
      update: {},
      create: {
        provider: adapter.provider,
        apiVersion: adapter.apiVersion,
        productKind: route.productKind,
        markupBasisPoints: 0,
      },
    }),
  ]);

  return {
    provider: adapter.provider,
    apiVersion: adapter.apiVersion,
    productKind: route.productKind,
    status,
    catalogVersion,
    regionCount: regions.length,
    successfulRegions,
    failedRegions: failures.length,
    planCount,
    imageCount,
    networkCount,
    securityCount,
    catalogItemCount,
    pricedItemCount,
    unavailableItemCount,
    staleItemCount,
    invalidPriceCount,
    invalidResourceCount,
    failures,
    durationMs,
  };
}

async function acquireCatalogSyncLease(
  provider: InfrastructureProvider,
  apiVersion: string,
): Promise<string> {
  const token = randomUUID();
  const now = new Date();
  await prisma.providerCatalogState.upsert({
    where: { provider },
    update: {},
    create: {
      id: `${provider.toLowerCase()}-${apiVersion}`,
      provider,
      apiVersion,
    },
  });
  const acquired = await prisma.providerCatalogState.updateMany({
    where: {
      provider,
      OR: [
        { syncLeaseToken: null },
        { syncLeaseExpiresAt: null },
        { syncLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      syncLeaseToken: token,
      syncLeaseExpiresAt: new Date(now.getTime() + CATALOG_SYNC_LEASE_MS),
    },
  });
  if (acquired.count !== 1) throw new Error("catalog_sync_already_running");
  return token;
}

async function releaseCatalogSyncLease(
  provider: InfrastructureProvider,
  token: string,
): Promise<void> {
  await prisma.providerCatalogState.updateMany({
    where: { provider, syncLeaseToken: token },
    data: { syncLeaseToken: null, syncLeaseExpiresAt: null },
  });
}

export async function syncMultiProviderCatalog(
  adapter: CloudProviderAdapter,
  now = new Date(),
) {
  return withCatalogSyncLease(adapter.provider, adapter.apiVersion, () =>
    syncMultiProviderCatalogUnlocked(adapter, now),
  );
}

export async function withCatalogSyncLease<T>(
  provider: InfrastructureProvider,
  apiVersion: string,
  operation: () => Promise<T>,
): Promise<T> {
  const token = await acquireCatalogSyncLease(provider, apiVersion);
  try {
    return await operation();
  } finally {
    await releaseCatalogSyncLease(provider, token);
  }
}

export async function requestCatalogSync(
  provider: InfrastructureProvider,
): Promise<void> {
  await prisma.providerCatalogState.updateMany({
    where: { provider },
    data: { syncRequestedAt: new Date() },
  });
}

export async function getCatalogFreshness(
  provider: InfrastructureProvider,
  now = new Date(),
) {
  const state = await prisma.providerCatalogState.findUnique({
    where: { provider },
  });
  const lastSync = state?.lastCatalogSync ?? null;
  const slaSeconds = state?.freshnessSlaSeconds ?? 900;
  const fresh =
    state?.enabled === true &&
    state.lastSyncStatus === ProviderSyncStatus.SUCCEEDED &&
    lastSync != null &&
    now.getTime() - lastSync.getTime() <= slaSeconds * 1000;
  return { fresh, lastSync, slaSeconds, state };
}

export async function refreshMultiProviderCatalog(
  provider: InfrastructureProvider,
) {
  if (!isCloudProviderConfigured(provider)) {
    throw new Error("provider_not_configured");
  }
  const regionCodes = await listProviderSyncRegionCodes(provider, "v1");
  if (regionCodes.length === 0) {
    throw new Error("provider_regions_not_configured");
  }
  return syncMultiProviderCatalog(
    createCloudProviderAdapter(provider, "v1", { regionCodes }),
  );
}
