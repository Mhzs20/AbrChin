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

export function getEnv() {
  const isProduction = process.env.NODE_ENV === "production";
  const parspackConfiguredBase = (
    process.env.PARSPACK_API_BASE_URL ?? ""
  ).trim();
  const parspackLegacyPublicBase = (
    process.env.PARSPACK_PUBLIC_API_BASE_URL ?? ""
  ).trim();
  const parspackManagementBase = (
    process.env.PARSPACK_MANAGEMENT_API_BASE_URL ??
    (parspackConfiguredBase &&
    !parspackConfiguredBase.includes("/public/")
      ? parspackConfiguredBase
      : "https://my.parspack.com/cserver/api/v1")
  ).trim();
  const parspackCatalogBase =
    parspackConfiguredBase.includes("/public/")
      ? parspackConfiguredBase
      : parspackLegacyPublicBase ||
        "https://my.parspack.com/cserver/api/public/v1";
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
    parspackEnabled: readBool("PARSPACK_ENABLED", false),
    parspackPublicSaleEnabled: readBool(
      "PARSPACK_PUBLIC_SALE_ENABLED",
      false,
    ),
    parspackApiBaseUrl: parspackManagementBase,
    parspackPublicApiBaseUrl: parspackCatalogBase,
    parspackApiToken: process.env.PARSPACK_API_TOKEN ?? "",
    parspackTimeoutMs: readInt("PARSPACK_TIMEOUT_MS", 15_000),
    parspackPriceCurrency: (process.env.PARSPACK_PRICE_CURRENCY ?? "").trim().toUpperCase(),
    parspackPriceAmountUnit: (process.env.PARSPACK_PRICE_AMOUNT_UNIT ?? "")
      .trim()
      .toUpperCase(),
    parspackApiVersion: (process.env.PARSPACK_API_VERSION ?? "v1")
      .trim()
      .toLowerCase(),
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
    // Public checkout is a separate operational decision from provider
    // connectivity and lifecycle mutation capability. It is fail-closed.
    arvanPublicSaleEnabled: readBool(
      "ARVAN_PUBLIC_SALE_ENABLED",
      false,
    ),
    // Lifecycle writes stay disabled until a separately approved staging
    // exercise. Merely configuring an API key must never enable mutations.
    arvanMutationsEnabled: readBool("ARVAN_MUTATIONS_ENABLED", false),
    infrastructureProviderMode: (process.env.INFRASTRUCTURE_PROVIDER_MODE ?? "mock").toLowerCase(),
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
  if (env.parspackApiVersion !== "v1") {
    throw new Error("PARSPACK_API_VERSION must be v1");
  }
  if (
    env.parspackEnabled &&
    (!env.parspackApiToken ||
      !/\/api\/public\/v1\/?$/i.test(env.parspackPublicApiBaseUrl) ||
      env.parspackPriceCurrency !== "IRR" ||
      !["RIAL", "TOMAN"].includes(env.parspackPriceAmountUnit))
  ) {
    throw new Error("ParsPack v1 price contract is not fully configured");
  }
  return env;
}

export function isAdminMobile(mobile: string): boolean {
  return getEnv().adminMobiles.includes(mobile);
}
