function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getEnv() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    smsProvider: (process.env.SMS_PROVIDER ?? "console").toLowerCase(),
    smsApiKey: process.env.SMS_API_KEY ?? "",
    smsSender: process.env.SMS_SENDER ?? "",
    otpTtlSeconds: readInt("OTP_TTL_SECONDS", 120),
    sessionTtlDays: readInt("SESSION_TTL_DAYS", 30),
    nodeEnv: process.env.NODE_ENV ?? "development",
    isProduction: process.env.NODE_ENV === "production",
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
