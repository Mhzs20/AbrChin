import type { PaymentGatewayProvider } from "@prisma/client";

export type PaymentGatewayName = "zibal" | "zarinpal" | "mock";

export type CreatePaymentInput = {
  amountRial: bigint;
  description: string;
  callbackUrl: string;
  metadata?: Record<string, string>;
};

export type CreatePaymentResult = {
  authority: string;
  redirectUrl: string;
  gatewayReference?: string;
};

export type VerifyPaymentInput = {
  authority: string;
  expectedAmountRial: bigint;
  statusHint?: string | null;
};

export type VerifyPaymentResult =
  | {
      ok: true;
      authority: string;
      gatewayReference: string;
      amountRial: bigint;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export type CallbackParams = Record<string, string | null | undefined>;

export type NormalizedCallback = {
  authority: string | null;
  statusHint: string | null;
  orderId: string | null;
  successHint: boolean | null;
};

export type ConfigurationValidation =
  | { ok: true }
  | { ok: false; code: "missing_credentials" | "invalid_environment"; message: string };

/**
 * Shared payment provider contract.
 * Bank refund (`refundPayment`) is intentionally omitted in v1; keep adapters ready for a future product decision.
 */
export interface PaymentProvider {
  readonly name: PaymentGatewayName;
  readonly prismaProvider: PaymentGatewayProvider;
  validateConfiguration(): ConfigurationValidation;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  buildRedirectUrl(authority: string): string;
  normalizeCallback(params: CallbackParams): NormalizedCallback;
}

export function providerSlugToEnum(name: PaymentGatewayName): PaymentGatewayProvider {
  if (name === "zibal") return "ZIBAL";
  if (name === "zarinpal") return "ZARINPAL";
  return "MOCK";
}

export function providerEnumToSlug(provider: PaymentGatewayProvider): PaymentGatewayName {
  if (provider === "ZIBAL") return "zibal";
  if (provider === "ZARINPAL") return "zarinpal";
  return "mock";
}

export function parseProviderParam(raw: string | null | undefined): PaymentGatewayProvider | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (value === "ZIBAL" || value === "ZARINPAL" || value === "MOCK") return value;
  const lower = raw.trim().toLowerCase();
  if (lower === "zibal") return "ZIBAL";
  if (lower === "zarinpal") return "ZARINPAL";
  if (lower === "mock") return "MOCK";
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
