import { parseArvanRegionCodes } from "./infrastructure/arvan/regions.ts";

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

function rejectDeprecatedMessageGoEnv() {
  const renamed: Array<[string, string]> = [
    ["MESSAGEGO_V2_SETTLEMENT_ENABLED", "MESSAGEGO_SETTLEMENT_ENABLED"],
    ["MESSAGEGO_V2_CUSTOMER_UX_ENABLED", "MESSAGEGO_CUSTOMER_AI_ENABLED"],
    ["MESSAGEGO_V2_SECRET_HANDOFF_ENABLED", "MESSAGEGO_SECRET_HANDOFF_ENABLED"],
    ["MESSAGEGO_V2_S2S_KEYRING_FILE", "MESSAGEGO_S2S_KEYRING_FILE"],
    ["MESSAGEGO_V2_S2S_SIGNING_KEYRING_FILE", "MESSAGEGO_S2S_SIGNING_KEYRING_FILE"],
    ["MESSAGEGO_V2_S2S_SIGNING_SERVICE_ID", "MESSAGEGO_S2S_SIGNING_SERVICE_ID"],
    ["MESSAGEGO_V2_S2S_ALLOWED_SERVICE_IDS", "MESSAGEGO_S2S_ALLOWED_SERVICE_IDS"],
    ["MESSAGEGO_V2_S2S_MAX_CLOCK_SKEW_SECONDS", "MESSAGEGO_S2S_MAX_CLOCK_SKEW_SECONDS"],
    ["MESSAGEGO_V2_MESSAGEGO_BASE_URL", "MESSAGEGO_HANDOFF_BASE_URL"],
    ["MESSAGEGO_V2_HANDOFF_PATH", "MESSAGEGO_HANDOFF_PATH"],
  ];
  for (const [legacy, canonical] of renamed) {
    if ((process.env[legacy] ?? "").trim() !== "") {
      throw new Error(`${legacy} is not accepted; use ${canonical}`);
    }
  }
}

export function getEnv() {
  rejectDeprecatedMessageGoEnv();
  const isProduction = process.env.NODE_ENV === "production";
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? "",
    smsProvider: (process.env.SMS_PROVIDER ?? "console").toLowerCase(),
    kavenegarApiKey: process.env.KAVENEGAR_API_KEY ?? "",
    kavenegarTemplate: process.env.KAVENEGAR_TEMPLATE ?? "abrchinlogin",
    kavenegarAlertTemplate: process.env.KAVENEGAR_ALERT_TEMPLATE ?? "",
    kavenegarTimeoutMs: readInt("KAVENEGAR_TIMEOUT_MS", 8000),
    otpTtlSeconds: readInt("OTP_TTL_SECONDS", 120),
    sessionTtlDays: readInt("SESSION_TTL_DAYS", 30),
    zibalMerchant: process.env.ZIBAL_MERCHANT ?? "",
    zibalTimeoutMs: readInt("ZIBAL_TIMEOUT_MS", 10_000),
    zarinpalMerchantId: process.env.ZARINPAL_MERCHANT_ID ?? "",
    zarinpalSandbox: readBool("ZARINPAL_SANDBOX", !isProduction),
    zarinpalTimeoutMs: readInt("ZARINPAL_TIMEOUT_MS", 10_000),
    paymentCallbackBaseUrl: process.env.PAYMENT_CALLBACK_BASE_URL ?? "http://localhost:3010",
    paymentBootstrapDefaultProvider: (
      process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER ?? "zibal"
    ).toLowerCase(),
    adminMobiles: (process.env.ADMIN_MOBILES ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    messageGoBaseUrl: (process.env.MESSAGEGO_BASE_URL ?? "").trim(),
    messageGoClientId: (process.env.MESSAGEGO_CLIENT_ID ?? "").trim(),
    messageGoClientSecret: process.env.MESSAGEGO_CLIENT_SECRET ?? "",
    messageGoTenantId: (process.env.MESSAGEGO_TENANT_ID ?? "").trim(),
    messageGoWorkspaceId: (process.env.MESSAGEGO_WORKSPACE_ID ?? "").trim(),
    messageGoTimeoutMs: readInt("MESSAGEGO_TIMEOUT_MS", 15_000),
    messageGoSettlementServiceCredential: (
      process.env.MESSAGEGO_SETTLEMENT_SERVICE_CREDENTIAL ?? ""
    ).trim(),
    messageGoSettlementEnabled: readBool("MESSAGEGO_SETTLEMENT_ENABLED", false),
    messageGoCustomerAiEnabled: readBool("MESSAGEGO_CUSTOMER_AI_ENABLED", false),
    messageGoSecretHandoffEnabled: readBool("MESSAGEGO_SECRET_HANDOFF_ENABLED", false),
    messageGoS2SKeyringFile: (process.env.MESSAGEGO_S2S_KEYRING_FILE ?? "").trim(),
    messageGoS2SSigningKeyringFile: (
      process.env.MESSAGEGO_S2S_SIGNING_KEYRING_FILE ?? ""
    ).trim(),
    messageGoS2SSigningServiceId: (
      process.env.MESSAGEGO_S2S_SIGNING_SERVICE_ID ?? "abrchin"
    ).trim(),
    messageGoS2SAllowedServiceIds: (process.env.MESSAGEGO_S2S_ALLOWED_SERVICE_IDS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    messageGoS2SMaxClockSkewSeconds: readInt("MESSAGEGO_S2S_MAX_CLOCK_SKEW_SECONDS", 300),
    messageGoHandoffBaseUrl: (process.env.MESSAGEGO_HANDOFF_BASE_URL ?? "").trim(),
    messageGoHandoffPath: (
      process.env.MESSAGEGO_HANDOFF_PATH ?? "/internal/v2/handoff"
    ).trim(),
    // Founder policy (2026-08-10): public sale stays open by default. The
    // provider/source gates and freshness/availability checks still prevent an
    // invalid offer from being sold, without coupling checkout to mutations.
    publicSaleEnabled: readBool("PUBLIC_SALE_ENABLED", true),
    arvanEnabled: readBool("ARVAN_ENABLED", false),
    arvanApiKey: process.env.ARVAN_API_KEY ?? "",
    arvanApiBaseUrl:
      process.env.ARVAN_API_BASE_URL ??
      "https://napi.arvancloud.ir/ecc/v1",
    arvanApiVersion: (process.env.ARVAN_API_VERSION ?? "v1")
      .trim()
      .toLowerCase(),
    arvanRegionCodesCsv: process.env.ARVAN_REGION_CODES ?? "",
    arvanTimeoutMs: readInt("ARVAN_TIMEOUT_MS", 15_000),
    arvanGetAttempts: readInt("ARVAN_GET_ATTEMPTS", 3),
    // Published provider/source offers are sale-enabled by default. Runtime
    // eligibility still depends on product, region, stock and fresh pricing.
    arvanPublicSaleEnabled: readBool(
      "ARVAN_PUBLIC_SALE_ENABLED",
      true,
    ),
    arvanReadyPublicSaleEnabled: readBool(
      "ARVAN_READY_PUBLIC_SALE_ENABLED",
      true,
    ),
    arvanCloudPublicSaleEnabled: readBool(
      "ARVAN_CLOUD_PUBLIC_SALE_ENABLED",
      true,
    ),
    manualReadyPublicSaleEnabled: readBool(
      "MANUAL_READY_PUBLIC_SALE_ENABLED",
      true,
    ),
    // Lifecycle writes stay disabled until a separately approved staging
    // exercise. Merely configuring an API key must never enable mutations.
    arvanMutationsEnabled: readBool("ARVAN_MUTATIONS_ENABLED", false),
    infrastructureProviderMode: (process.env.INFRASTRUCTURE_PROVIDER_MODE ?? "mock").toLowerCase(),
    emailProvider: (process.env.EMAIL_PROVIDER ?? "console").toLowerCase(),
    emailFrom: (process.env.EMAIL_FROM ?? "").trim(),
    smtpHost: (process.env.SMTP_HOST ?? "").trim(),
    smtpPort: readInt("SMTP_PORT", 587),
    smtpSecure: readBool("SMTP_SECURE", false),
    smtpUser: (process.env.SMTP_USER ?? "").trim(),
    smtpPassword: process.env.SMTP_PASSWORD ?? "",
    smtpTimeoutMs: readInt("SMTP_TIMEOUT_MS", 10_000),
    emailVerificationTtlSeconds: readInt("EMAIL_VERIFICATION_TTL_SECONDS", 600),
    nodeEnv: process.env.NODE_ENV ?? "development",
    isProduction,
  };
}

export function assertCredentialEncryptionKey(): string {
  const key = getEnv().credentialEncryptionKey;
  if (!key) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
  }
  return key;
}

export function assertServerSecrets() {
  const env = getEnv();
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!env.sessionSecret || env.sessionSecret.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 characters)");
  }
  return env;
}

export function validateProviderEnvironment() {
  const env = getEnv();
  if (env.arvanApiVersion !== "v1") {
    throw new Error("ARVAN_API_VERSION must be v1");
  }
  if (/\/v3(?:\/|$)/i.test(env.arvanApiBaseUrl)) {
    throw new Error("Arvan API v3 is disabled");
  }
  if (
    env.arvanEnabled &&
    (!env.arvanApiKey ||
      !/\/ecc\/v1(?:\/regions)?\/?$/i.test(env.arvanApiBaseUrl))
  ) {
    throw new Error("Arvan v1 provider configuration is invalid");
  }
  if (env.arvanEnabled) {
    // Optional bootstrap only. Runtime region control lives in the database;
    // when supplied, the CSV is still strictly validated before startup.
    parseArvanRegionCodes(env.arvanRegionCodesCsv);
  }
  return env;
}

export function isAdminMobile(mobile: string): boolean {
  return getEnv().adminMobiles.includes(mobile);
}
