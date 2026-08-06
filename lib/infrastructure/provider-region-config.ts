import {
  InfrastructureProvider,
  ProviderRegionConfigSource,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fetchArvanRegionsFromProvider } from "@/lib/infrastructure/arvan/discover-regions";
import {
  arvanRegionPresentation,
  parseArvanRegionCodes,
} from "@/lib/infrastructure/arvan/regions";

const REGION_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeProviderRegionCode(value: string): string {
  const code = value.trim().toLowerCase();
  if (!code || code.length > 64 || !REGION_CODE_PATTERN.test(code)) {
    throw new Error("provider_invalid_region_config");
  }
  return code;
}

export function normalizeProviderRegionDisplayName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) {
    throw new Error("provider_invalid_region_display_name");
  }
  return name;
}

async function bootstrapArvanRegionsFromEnvironment(
  tx: Prisma.TransactionClient,
) {
  const codes = parseArvanRegionCodes(getEnv().arvanRegionCodesCsv);
  if (codes.length === 0) return;
  await tx.providerRegionConfig.createMany({
    data: codes.map((regionCode) => {
      const presentation = arvanRegionPresentation(regionCode);
      return {
        provider: InfrastructureProvider.ARVAN,
        apiVersion: "v1",
        regionCode,
        displayName: presentation.label,
        source: ProviderRegionConfigSource.ENV_BOOTSTRAP,
        syncEnabled: true,
        saleEnabled: true,
        sortOrder: presentation.sortOrder,
      };
    }),
    skipDuplicates: true,
  });
}

export async function ensureProviderRegionBootstrap(
  provider: InfrastructureProvider,
  apiVersion = "v1",
) {
  if (provider !== InfrastructureProvider.ARVAN || apiVersion !== "v1") {
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`provider-region-bootstrap:${provider}:${apiVersion}`}, 0)
      )::text AS locked
    `;
    const existing = await tx.providerRegionConfig.count({
      where: { provider, apiVersion },
    });
    if (existing === 0) await bootstrapArvanRegionsFromEnvironment(tx);
  });
}

export async function listProviderRegionConfigs(input: {
  provider: InfrastructureProvider;
  apiVersion?: string;
  purpose?: "SYNC" | "SALE" | "ALL";
}) {
  const apiVersion = input.apiVersion ?? "v1";
  await ensureProviderRegionBootstrap(input.provider, apiVersion);
  return prisma.providerRegionConfig.findMany({
    where: {
      provider: input.provider,
      apiVersion,
      ...(input.purpose === "SYNC"
        ? { syncEnabled: true }
        : input.purpose === "SALE"
          ? { saleEnabled: true }
          : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { regionCode: "asc" }],
  });
}

export async function listProviderSyncRegionCodes(
  provider: InfrastructureProvider,
  apiVersion = "v1",
): Promise<string[]> {
  const regions = await listProviderRegionConfigs({
    provider,
    apiVersion,
    purpose: "SYNC",
  });
  return regions.map((region) => region.regionCode);
}

export async function isRegionEnabledForSale(input: {
  provider: InfrastructureProvider;
  apiVersion: string;
  regionCode: string;
}) {
  await ensureProviderRegionBootstrap(input.provider, input.apiVersion);
  return Boolean(
    await prisma.providerRegionConfig.findFirst({
      where: {
        provider: input.provider,
        apiVersion: input.apiVersion,
        regionCode: input.regionCode,
        saleEnabled: true,
      },
      select: { id: true },
    }),
  );
}

/**
 * Pull every Arvan region from GET /regions into ProviderRegionConfig.
 * New rows default Sync+Sale enabled. Admin disables are never re-enabled.
 */
export async function syncArvanRegionsFromProvider(input?: {
  actorUserId?: string | null;
  fetchImpl?: typeof fetch;
}) {
  const discovered = await fetchArvanRegionsFromProvider({
    fetchImpl: input?.fetchImpl,
  });
  const actorUserId = input?.actorUserId ?? null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${"provider-region-discovery:ARVAN:v1"}, 0)
      )::text AS locked
    `;

    let created = 0;
    let unchanged = 0;
    let refreshed = 0;

    for (const [index, region] of discovered.entries()) {
      const presentation = arvanRegionPresentation(region.regionCode);
      const existing = await tx.providerRegionConfig.findUnique({
        where: {
          provider_apiVersion_regionCode: {
            provider: InfrastructureProvider.ARVAN,
            apiVersion: "v1",
            regionCode: region.regionCode,
          },
        },
      });

      if (!existing) {
        await tx.providerRegionConfig.create({
          data: {
            provider: InfrastructureProvider.ARVAN,
            apiVersion: "v1",
            regionCode: region.regionCode,
            displayName: region.displayName,
            source: ProviderRegionConfigSource.PROVIDER_DISCOVERY,
            syncEnabled: true,
            saleEnabled: true,
            sortOrder: presentation.sortOrder || index,
            lastValidatedAt: new Date(),
            lastValidationCode: "provider_region_discovered",
            createdById: actorUserId,
            updatedById: actorUserId,
          },
        });
        created += 1;
        continue;
      }

      // Never re-enable Sync/Sale. Admin rows keep their flags and labels.
      if (existing.source === ProviderRegionConfigSource.ADMIN) {
        unchanged += 1;
        continue;
      }

      const nextSortOrder = presentation.sortOrder || existing.sortOrder;
      if (
        existing.displayName === region.displayName &&
        existing.sortOrder === nextSortOrder &&
        existing.lastValidationCode === "provider_region_discovered"
      ) {
        unchanged += 1;
        continue;
      }

      await tx.providerRegionConfig.update({
        where: { id: existing.id },
        data: {
          displayName: region.displayName,
          sortOrder: nextSortOrder,
          source: ProviderRegionConfigSource.PROVIDER_DISCOVERY,
          lastValidatedAt: new Date(),
          lastValidationCode: "provider_region_discovered",
          updatedById: actorUserId,
        },
      });
      refreshed += 1;
    }

    return {
      discoveredCount: discovered.length,
      created,
      refreshed,
      unchanged,
      regionCodes: discovered.map((region) => region.regionCode),
    };
  });
}
