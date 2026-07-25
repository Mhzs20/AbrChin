import { PaymentGatewayEnvironment, PaymentGatewayProvider } from "@prisma/client";

import { getEnv } from "../env.ts";
import { MockPaymentProvider } from "./mock-provider.ts";
import type { PaymentProvider } from "./types.ts";
import { ZarinpalPaymentProvider } from "./zarinpal-provider.ts";
import { ZibalPaymentProvider } from "./zibal-provider.ts";

export function hasServerCredentials(provider: PaymentGatewayProvider): boolean {
  const env = getEnv();
  if (provider === PaymentGatewayProvider.ZIBAL) {
    return Boolean(env.zibalMerchant.trim());
  }
  if (provider === PaymentGatewayProvider.ZARINPAL) {
    return Boolean(env.zarinpalMerchantId.trim());
  }
  return !env.isProduction;
}

export function createProviderFor(
  provider: PaymentGatewayProvider,
  options?: { environment?: PaymentGatewayEnvironment },
): PaymentProvider {
  const env = getEnv();

  if (provider === PaymentGatewayProvider.ZIBAL) {
    return new ZibalPaymentProvider({
      merchant: env.zibalMerchant,
      timeoutMs: env.zibalTimeoutMs,
    });
  }

  if (provider === PaymentGatewayProvider.ZARINPAL) {
    const sandboxFromDb = options?.environment === PaymentGatewayEnvironment.SANDBOX;
    const sandbox =
      options?.environment === PaymentGatewayEnvironment.PRODUCTION
        ? false
        : sandboxFromDb || env.zarinpalSandbox;
    return new ZarinpalPaymentProvider({
      merchantId: env.zarinpalMerchantId,
      sandbox,
      timeoutMs: env.zarinpalTimeoutMs,
    });
  }

  return new MockPaymentProvider(env.paymentCallbackBaseUrl);
}

/** Test helper: build providers with injectable fetch. */
export function createZibalForTest(config: {
  merchant: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  return new ZibalPaymentProvider({
    merchant: config.merchant,
    timeoutMs: config.timeoutMs ?? 2000,
    fetchImpl: config.fetchImpl,
  });
}

export function createZarinpalForTest(config: {
  merchantId: string;
  sandbox?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}) {
  return new ZarinpalPaymentProvider({
    merchantId: config.merchantId,
    sandbox: config.sandbox ?? true,
    timeoutMs: config.timeoutMs ?? 2000,
    fetchImpl: config.fetchImpl,
  });
}
