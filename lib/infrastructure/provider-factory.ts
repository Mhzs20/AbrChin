import { InfrastructureProvider } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { ArvanV1Adapter } from "@/lib/infrastructure/arvan/v1-adapter";
import { parseArvanRegionCodes } from "@/lib/infrastructure/arvan/regions";
import type { CloudProviderAdapter } from "@/lib/infrastructure/cloud-provider-adapter";
import { InfrastructureError } from "@/lib/infrastructure/errors";
import { FakeCloudProviderAdapter } from "@/lib/infrastructure/fake-cloud-provider-adapter";
import { MockInfrastructureProvider } from "@/lib/infrastructure/mock-provider";
import type { InfrastructureProviderAdapter } from "@/lib/infrastructure/types";

/**
 * ArvanCloud is the platform's only infrastructure provider. The legacy
 * multi-provider indirection is gone: the mock adapter is the sole
 * non-production alternative and it is refused in production.
 */
export function getInfrastructureProviderMode(): "mock" {
  return "mock";
}

export function createInfrastructureProvider(): InfrastructureProviderAdapter {
  const env = getEnv();
  if (env.isProduction) {
    throw new InfrastructureError(
      "provider_disabled",
      "Mock provider is not allowed in production",
    );
  }
  return new MockInfrastructureProvider();
}

export function createCloudProviderAdapter(
  provider: InfrastructureProvider,
  apiVersion = "v1",
  options?: { allowFake?: boolean; regionCodes?: string[] },
): CloudProviderAdapter {
  const env = getEnv();
  if (apiVersion.trim().toLowerCase() !== "v1") {
    throw new InfrastructureError(
      "provider_version_disabled",
      "Only provider API v1 is enabled",
    );
  }
  if (options?.allowFake) {
    if (env.isProduction) {
      throw new InfrastructureError(
        "provider_disabled",
        "Fake provider is not allowed in production",
      );
    }
    return new FakeCloudProviderAdapter({ provider, apiVersion: "v1" });
  }
  if (provider === InfrastructureProvider.ARVAN) {
    if (!env.arvanEnabled || !env.arvanApiKey) {
      throw new InfrastructureError(
        "provider_disabled",
        "Arvan provider is not configured",
      );
    }
    return new ArvanV1Adapter({
      apiKey: env.arvanApiKey,
      regionCodes:
        options?.regionCodes ??
        parseArvanRegionCodes(env.arvanRegionCodesCsv),
      baseUrl: env.arvanApiBaseUrl,
      timeoutMs: env.arvanTimeoutMs,
      maxGetAttempts: env.arvanGetAttempts,
      mutationsEnabled: env.arvanMutationsEnabled,
      logger: (entry) => console.info(JSON.stringify(entry)),
    });
  }
  throw new InfrastructureError(
    "provider_disabled",
    "Provider is not supported",
  );
}

export function isCloudProviderConfigured(
  provider: InfrastructureProvider,
): boolean {
  if (provider !== InfrastructureProvider.ARVAN) return false;
  const env = getEnv();
  try {
    return (
      env.arvanEnabled &&
      Boolean(env.arvanApiKey) &&
      env.arvanApiVersion === "v1"
    );
  } catch {
    return false;
  }
}

export function isProviderConfigured(): boolean {
  return !getEnv().isProduction;
}

export function providerDisplayName(provider: InfrastructureProvider): string {
  if (provider === InfrastructureProvider.ARVAN) return "آروان‌کلاد";
  return provider;
}
