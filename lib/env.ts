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
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    smsProvider: (process.env.SMS_PROVIDER ?? "console").toLowerCase(),
    kavenegarApiKey: process.env.KAVENEGAR_API_KEY ?? "",
    kavenegarTemplate: process.env.KAVENEGAR_TEMPLATE ?? "abrchinlogin",
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
    parspackApiBaseUrl: process.env.PARSPACK_API_BASE_URL ?? "https://my.parspack.com/cserver/api/v1",
    parspackPublicApiBaseUrl:
      process.env.PARSPACK_PUBLIC_API_BASE_URL ??
      "https://my.parspack.com/cserver/api/public/v1",
    parspackApiToken: process.env.PARSPACK_API_TOKEN ?? "",
    parspackTimeoutMs: readInt("PARSPACK_TIMEOUT_MS", 15_000),
    infrastructureProviderMode: (process.env.INFRASTRUCTURE_PROVIDER_MODE ?? "mock").toLowerCase(),
    nodeEnv: process.env.NODE_ENV ?? "development",
    isProduction,
  };
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

export function isAdminMobile(mobile: string): boolean {
  return getEnv().adminMobiles.includes(mobile);
}
