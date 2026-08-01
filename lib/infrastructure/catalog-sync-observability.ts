import { InfrastructureProvider } from "@prisma/client";

const SAFE_PROVIDER_SYNC_CODES = new Set([
  "provider_auth_failed",
  "provider_timeout",
  "provider_invalid_response",
  "provider_unavailable",
  "provider_disabled",
  "provider_persistence_failed",
  "provider_sync_failed",
]);

export type SafeProviderSyncCode =
  | "provider_auth_failed"
  | "provider_timeout"
  | "provider_invalid_response"
  | "provider_unavailable"
  | "provider_disabled"
  | "provider_persistence_failed"
  | "provider_sync_failed";

const SAFE_MESSAGES: Record<SafeProviderSyncCode, string> = {
  provider_auth_failed:
    "احراز هویت ارائه‌دهنده ناموفق است؛ دسترسی Server باید بررسی شود.",
  provider_timeout:
    "پاسخ ارائه‌دهنده در زمان مجاز دریافت نشد؛ دادهٔ سالم قبلی حفظ شد.",
  provider_invalid_response:
    "پاسخ کاتالوگ با قرارداد مورد انتظار سازگار نبود؛ دادهٔ سالم قبلی حفظ شد.",
  provider_unavailable:
    "ارائه‌دهنده موقتاً در دسترس نیست؛ دادهٔ سالم قبلی حفظ شد.",
  provider_disabled:
    "ارائه‌دهنده در محیط Server به‌طور کامل تنظیم نشده است.",
  provider_persistence_failed:
    "ذخیره‌سازی نتیجهٔ Sync کامل نشد؛ بررسی عملیاتی لازم است.",
  provider_sync_failed:
    "همگام‌سازی کاتالوگ کامل نشد؛ دادهٔ سالم قبلی حفظ شد.",
};

export class ProviderCatalogSyncError extends Error {
  readonly code: SafeProviderSyncCode;
  readonly provider: InfrastructureProvider;
  readonly apiVersion: string;
  readonly operation: string;

  constructor(input: {
    provider: InfrastructureProvider;
    apiVersion: string;
    operation: string;
    code: SafeProviderSyncCode;
  }) {
    super(SAFE_MESSAGES[input.code]);
    this.name = "ProviderCatalogSyncError";
    this.code = input.code;
    this.provider = input.provider;
    this.apiVersion = input.apiVersion;
    this.operation = input.operation;
  }
}

export function safeProviderSyncCode(error: unknown): SafeProviderSyncCode {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    SAFE_PROVIDER_SYNC_CODES.has(error.code)
  ) {
    return error.code as SafeProviderSyncCode;
  }
  return "provider_sync_failed";
}

export function safeProviderSyncMessage(
  code: SafeProviderSyncCode,
): string {
  return SAFE_MESSAGES[code];
}

export type ProviderCatalogSyncTask = {
  provider: InfrastructureProvider;
  apiVersion: string;
  operation: "catalog_sync";
  promise: Promise<unknown>;
};

export async function settleProviderCatalogSyncTasks(
  tasks: ProviderCatalogSyncTask[],
  logger: (entry: Record<string, unknown>) => void = (entry) =>
    console.info(JSON.stringify(entry)),
) {
  const results = await Promise.allSettled(tasks.map((task) => task.promise));
  results.forEach((result, index) => {
    const task = tasks[index];
    if (!task) return;
    logger({
      event: "provider_catalog_sync",
      provider: task.provider,
      apiVersion: task.apiVersion,
      operation: task.operation,
      syncStatus: result.status === "fulfilled" ? "SUCCEEDED" : "FAILED",
      ...(result.status === "rejected"
        ? { safeErrorCode: safeProviderSyncCode(result.reason) }
        : {}),
    });
  });
  return results;
}
