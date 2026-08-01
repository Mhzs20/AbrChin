import {
  InfrastructureProvider,
  ProviderRegionConfigSource,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
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
