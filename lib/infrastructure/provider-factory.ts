import { InfrastructureProvider } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { InfrastructureError } from "@/lib/infrastructure/errors";
import { MockInfrastructureProvider } from "@/lib/infrastructure/mock-provider";
import { ParsPackProvider } from "@/lib/infrastructure/parspack/client";
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
      baseUrl: env.parspackApiBaseUrl,
      token: env.parspackApiToken,
      timeoutMs: env.parspackTimeoutMs,
    });
  }

  if (env.isProduction) {
    throw new InfrastructureError("provider_disabled", "Mock provider is not allowed in production");
  }

  return new MockInfrastructureProvider();
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
  return provider;
}
