import { InfrastructureProvider } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { ArvanV1Adapter } from "@/lib/infrastructure/arvan/v1-adapter";
import type { CloudProviderAdapter } from "@/lib/infrastructure/cloud-provider-adapter";
import { InfrastructureError } from "@/lib/infrastructure/errors";
import { FakeCloudProviderAdapter } from "@/lib/infrastructure/fake-cloud-provider-adapter";
import { MockInfrastructureProvider } from "@/lib/infrastructure/mock-provider";
import { ParsPackProvider } from "@/lib/infrastructure/parspack/client";
import { ParsPackV1Adapter } from "@/lib/infrastructure/parspack/v1-adapter";
import type { InfrastructureProviderAdapter } from "@/lib/infrastructure/types";

export function getInfrastructureProviderMode(): "mock" | "parspack" {
  const mode = getEnv().infrastructureProviderMode;
  if (mode === "parspack") return "parspack";
  return "mock";
}

export function createInfrastructureProvider(): InfrastructureProviderAdapter {
  const env = getEnv();
  const mode = getInfrastructureProviderMode();

  if (mode === "parspack") {
    if (!env.parspackEnabled || !env.parspackApiToken) {
      throw new InfrastructureError("provider_disabled", "ParsPack provider is not configured");
    }
    if (env.isProduction && mode !== "parspack") {
      throw new InfrastructureError("provider_disabled", "Mock provider is not allowed in production");
    }
    return new ParsPackProvider({
      managementBaseUrl: env.parspackApiBaseUrl,
      publicBaseUrl: env.parspackPublicApiBaseUrl,
      token: env.parspackApiToken,
      timeoutMs: env.parspackTimeoutMs,
      priceCurrencyCode: env.parspackPriceCurrency,
      priceAmountUnit: env.parspackPriceAmountUnit,
    });
  }

  if (env.isProduction) {
    throw new InfrastructureError("provider_disabled", "Mock provider is not allowed in production");
  }

  return new MockInfrastructureProvider();
}

function createParsPackClient(): ParsPackProvider {
  const env = getEnv();
  if (!env.parspackEnabled || !env.parspackApiToken) {
    throw new InfrastructureError(
      "provider_disabled",
      "ParsPack provider is not configured",
    );
  }
  return new ParsPackProvider({
    managementBaseUrl: env.parspackApiBaseUrl,
    publicBaseUrl: env.parspackPublicApiBaseUrl,
    token: env.parspackApiToken,
    timeoutMs: env.parspackTimeoutMs,
    priceCurrencyCode: env.parspackPriceCurrency,
    priceAmountUnit: env.parspackPriceAmountUnit,
  });
}

export function createCloudProviderAdapter(
  provider: InfrastructureProvider,
  apiVersion = "v1",
  options?: { allowFake?: boolean },
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
      baseUrl: env.arvanApiBaseUrl,
      timeoutMs: env.arvanTimeoutMs,
      maxGetAttempts: env.arvanGetAttempts,
      mutationsEnabled: env.arvanMutationsEnabled,
      logger: (entry) => console.info(JSON.stringify(entry)),
    });
  }
  if (provider === InfrastructureProvider.PARSPACK) {
    return new ParsPackV1Adapter(createParsPackClient());
  }
  throw new InfrastructureError(
    "provider_disabled",
    "Provider is not supported",
  );
}

export function isCloudProviderConfigured(
  provider: InfrastructureProvider,
): boolean {
  const env = getEnv();
  if (provider === InfrastructureProvider.ARVAN) {
    return (
      env.arvanEnabled &&
      Boolean(env.arvanApiKey) &&
      env.arvanApiVersion === "v1"
    );
  }
  if (provider === InfrastructureProvider.PARSPACK) {
    return (
      env.parspackEnabled &&
      Boolean(env.parspackApiToken) &&
      env.parspackApiVersion === "v1"
    );
  }
  return false;
}

export function isProviderConfigured(): boolean {
  const env = getEnv();
  const mode = getInfrastructureProviderMode();
  if (mode === "parspack") {
    return env.parspackEnabled && Boolean(env.parspackApiToken);
  }
  return !env.isProduction;
}

export function providerDisplayName(provider: InfrastructureProvider): string {
  if (provider === InfrastructureProvider.PARSPACK) return "پارس‌پک";
  if (provider === InfrastructureProvider.ARVAN) return "آروان‌کلاد";
  return provider;
}
