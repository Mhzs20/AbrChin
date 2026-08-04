#!/usr/bin/env node
import { InfrastructureProvider, ProviderSyncStatus } from "@prisma/client";

import { getEnv } from "@/lib/env";
import {
  safeProviderSyncCode,
  safeProviderSyncMessage,
} from "@/lib/infrastructure/catalog-sync-observability";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";

type CatalogSyncResult = Awaited<
  ReturnType<typeof refreshMultiProviderCatalog>
>;

function selectedProviders(value: string | undefined): InfrastructureProvider[] {
  if (value === "parspack") return [InfrastructureProvider.PARSPACK];
  if (value === "arvan") return [InfrastructureProvider.ARVAN];
  if (value === "all") {
    return [
      InfrastructureProvider.PARSPACK,
      InfrastructureProvider.ARVAN,
    ];
  }
  throw new Error("invalid_catalog_sync_provider");
}

function assertProviderConfiguration(provider: InfrastructureProvider): void {
  const env = getEnv();
  if (provider === InfrastructureProvider.PARSPACK) {
    if (
      !env.parspackEnabled ||
      !env.parspackApiToken ||
      env.parspackApiVersion !== "v1" ||
      !/\/api\/public\/v1\/?$/i.test(env.parspackPublicApiBaseUrl)
    ) {
      throw new Error("provider_configuration_invalid");
    }
    return;
  }
  if (
    !env.arvanEnabled ||
    !env.arvanApiKey ||
    env.arvanApiVersion !== "v1" ||
    !/\/ecc\/v1(?:\/regions)?\/?$/i.test(env.arvanApiBaseUrl)
  ) {
    throw new Error("provider_configuration_invalid");
  }
}

function safeSuccessOutput(
  result: CatalogSyncResult,
  startedAt: Date,
  completedAt: Date,
) {
  return {
    event: "provider_catalog_sync_result",
    readOnly: true,
    ok: result.status === ProviderSyncStatus.SUCCEEDED,
    provider: result.provider,
    apiVersion: result.apiVersion,
    status: result.status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: result.durationMs,
    catalogVersion: result.catalogVersion,
    counts: {
      regions: result.regionCount,
      successfulRegions: result.successfulRegions,
      failedRegions: result.failedRegions,
      plans: result.planCount,
      images: result.imageCount,
      networks: result.networkCount,
      securities: result.securityCount,
      catalogItems: result.catalogItemCount,
      pricedItems: result.pricedItemCount,
      unavailableItems: result.unavailableItemCount,
      staleItems: result.staleItemCount,
      invalidPriceItems: result.invalidPriceCount,
      invalidResourceItems: result.invalidResourceCount,
    },
    failureCodes: [
      ...new Set(result.failures.map((failure) => failure.code)),
    ],
  };
}

async function syncProvider(provider: InfrastructureProvider): Promise<boolean> {
  const startedAt = new Date();
  try {
    assertProviderConfiguration(provider);
    const result = await refreshMultiProviderCatalog(provider);
    const output = safeSuccessOutput(result, startedAt, new Date());
    console.log(JSON.stringify(output));
    return output.ok;
  } catch (error) {
    const code =
      error instanceof Error &&
      error.message === "provider_configuration_invalid"
        ? "provider_disabled"
        : safeProviderSyncCode(error);
    console.error(
      JSON.stringify({
        event: "provider_catalog_sync_result",
        readOnly: true,
        ok: false,
        provider,
        apiVersion: "v1",
        status: ProviderSyncStatus.FAILED,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        safeError: {
          code,
          message: safeProviderSyncMessage(code),
        },
      }),
    );
    return false;
  }
}

async function main() {
  let providers: InfrastructureProvider[];
  try {
    providers = selectedProviders(process.argv[2]?.trim().toLowerCase());
  } catch {
    console.error(
      JSON.stringify({
        event: "provider_catalog_sync_result",
        readOnly: true,
        ok: false,
        status: ProviderSyncStatus.FAILED,
        safeError: {
          code: "invalid_catalog_sync_provider",
          message: "Provider must be parspack, arvan, or all.",
        },
      }),
    );
    process.exitCode = 2;
    return;
  }

  let succeeded = true;
  for (const provider of providers) {
    succeeded = (await syncProvider(provider)) && succeeded;
  }
  if (!succeeded) process.exitCode = 1;
}

void main();
