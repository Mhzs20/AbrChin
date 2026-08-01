import { InfrastructureProvider } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { refreshProviderCatalogForPricing } from "@/lib/infrastructure/catalog-service";
import {
  safeProviderSyncCode,
  settleProviderCatalogSyncTasks,
} from "@/lib/infrastructure/catalog-sync-observability";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
import {
  isCloudProviderConfigured,
  isProviderConfigured,
} from "@/lib/infrastructure/provider-factory";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

function parseProvider(value: unknown): InfrastructureProvider | null {
  return value === InfrastructureProvider.ARVAN ||
    value === InfrastructureProvider.PARSPACK
    ? value
    : null;
}

async function publicState(provider: InfrastructureProvider) {
  const [state, pricing] = await Promise.all([
    prisma.providerCatalogState.findUnique({ where: { provider } }),
    prisma.providerPricingConfig.findUnique({ where: { provider } }),
  ]);
  if (!state) throw new Error("provider_state_missing");
  return {
    status:
      state.lastSyncStatus === "FAILED"
        ? "error"
        : state.lastError
          ? "warning"
          : "healthy",
    message:
      state.lastSyncStatus === "PARTIAL"
        ? "Sync ناقص؛ Regionهای سالم حفظ شدند"
        : state.lastError ?? "کاتالوگ و قیمت‌ها ذخیره شدند",
    apiVersion: state.apiVersion,
    enabled: state.enabled,
    lastHealthCheck: state.lastHealthCheck?.toISOString() ?? null,
    lastCatalogSync: state.lastCatalogSync?.toISOString() ?? null,
    regionCount: state.regionCount,
    sizeCount: state.sizeCount,
    imageCount: state.imageCount,
    catalogItemCount: state.catalogItemCount,
    pricedItemCount: state.pricedItemCount,
    unavailableItemCount: state.unavailableItemCount,
    staleItemCount: state.staleItemCount,
    invalidPriceCount: state.invalidPriceCount,
    invalidResourceCount: state.invalidResourceCount,
    networkCount: state.networkCount,
    securityCount: state.securityCount,
    syncDurationMs: state.lastSyncDurationMs,
    lastSyncStatus: state.lastSyncStatus,
    regionErrors: state.regionErrors,
    sourceMoneyUnit: pricing?.sourceMoneyUnit ?? null,
    lastProviderRequestId: state.lastProviderRequestId,
    markupBasisPoints: pricing?.markupBasisPoints ?? 0,
    lastError: state.lastError,
    configured: true,
  };
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    await requireAdminUser();
    const body = (await request.json().catch(() => ({}))) as {
      provider?: unknown;
    };
    const provider = parseProvider(body.provider);
    if (!provider) return jsonError("Provider معتبر نیست.", 400);

    let promise: Promise<unknown>;
    if (provider === InfrastructureProvider.ARVAN) {
      if (!isCloudProviderConfigured(provider)) {
        return jsonError("آروان‌کلاد تنظیم نشده است.", 400);
      }
      promise = refreshMultiProviderCatalog(provider);
    } else {
      if (!isProviderConfigured()) {
        return jsonError("پارس‌پک تنظیم نشده است.", 400);
      }
      promise = refreshProviderCatalogForPricing();
    }
    const [result] = await settleProviderCatalogSyncTasks(
      [{ provider, apiVersion: "v1", operation: "catalog_sync", promise }],
      undefined,
      { persistIncidents: true },
    );
    if (result?.status === "rejected") throw result.reason;
    return jsonOk({ state: await publicState(provider) });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      JSON.stringify({
        event: "admin_provider_catalog_sync",
        operation: "catalog_sync",
        safeErrorCode: safeProviderSyncCode(error),
        syncStatus: "FAILED",
      }),
    );
    return jsonError("همگام‌سازی کاتالوگ ممکن نیست.", 500);
  }
}
