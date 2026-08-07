import type { PaymentGatewayConfig, PaymentGatewayProvider } from "@prisma/client";

import { PaymentError } from "./errors.ts";
import {
  buildGatewaySnapshot,
  ensureGatewayConfigsSeeded,
  getDefaultGatewayConfig,
  getGatewayConfigByProvider,
  type GatewayConfigSnapshot,
} from "./gateway-config.ts";
import { createProviderFor } from "./provider-factory.ts";
import type { PaymentProvider } from "./types.ts";

export type ResolvedPaymentGateway = {
  config: PaymentGatewayConfig;
  provider: PaymentProvider;
  snapshot: GatewayConfigSnapshot;
};

/**
 * Resolves the admin-selected default gateway and validates env credentials.
 * Does NOT fall back to a second provider on createPayment failure.
 */
export async function resolveDefaultPaymentGateway(): Promise<ResolvedPaymentGateway> {
  await ensureGatewayConfigsSeeded();
  const config = await getDefaultGatewayConfig();
  if (!config || !config.enabled || !config.isDefault) {
    throw new PaymentError("gateway_unavailable", "درگاه پرداخت موقتاً در دسترس نیست");
  }

  const provider = createProviderFor(config.provider, { environment: config.environment });
  const validation = provider.validateConfiguration();
  if (!validation.ok) {
    throw new PaymentError("gateway_unavailable", "درگاه پرداخت موقتاً در دسترس نیست");
  }

  return {
    config,
    provider,
    snapshot: buildGatewaySnapshot(config),
  };
}

/**
 * Resolve provider locked on an existing TopUp — never uses current default.
 */
export async function resolveProviderForTopUp(
  gateway: PaymentGatewayProvider,
  environment?: PaymentGatewayConfig["environment"],
): Promise<PaymentProvider> {
  const provider = createProviderFor(gateway, environment ? { environment } : undefined);
  const validation = provider.validateConfiguration();
  if (!validation.ok) {
    throw new PaymentError("configuration", "درگاه پرداخت موقتاً در دسترس نیست");
  }
  return provider;
}

export async function getPublicDefaultGatewaySummary() {
  // Customer GET must not seed gateway rows; absent config → unavailable.
  const config = await getDefaultGatewayConfig();
  if (!config) {
    return { available: false as const, displayName: null, provider: null };
  }

  const provider = createProviderFor(config.provider, { environment: config.environment });
  const validation = provider.validateConfiguration();
  if (!validation.ok || !config.enabled) {
    return { available: false as const, displayName: null, provider: null };
  }

  return {
    available: true as const,
    displayName: config.displayName,
    provider: config.provider,
  };
}

export async function assertGatewayExists(provider: PaymentGatewayProvider) {
  return getGatewayConfigByProvider(provider);
}
