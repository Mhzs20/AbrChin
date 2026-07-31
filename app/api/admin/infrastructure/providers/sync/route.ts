import { InfrastructureProvider } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { persistProviderCatalog } from "@/lib/infrastructure/catalog-service";
import { refreshMultiProviderCatalog } from "@/lib/infrastructure/multi-provider-catalog-service";
import {
  createInfrastructureProvider,
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

    if (provider === InfrastructureProvider.ARVAN) {
      if (!isCloudProviderConfigured(provider)) {
        return jsonError("آروان‌کلاد تنظیم نشده است.", 400);
      }
      await refreshMultiProviderCatalog(provider);
      return jsonOk({ state: await publicState(provider) });
    }

    if (!isProviderConfigured()) {
      return jsonError("پارس‌پک تنظیم نشده است.", 400);
    }
    const adapter = createInfrastructureProvider();
    const syncedAt = new Date();
    const catalog = await adapter.syncCatalog();
    await prisma.$transaction(async (tx) => {
      const persisted = await persistProviderCatalog(tx, catalog, syncedAt);
      await tx.providerCatalogState.upsert({
        where: { provider },
        update: {
          apiVersion: "v1",
          lastCatalogSync: syncedAt,
          regionCount: catalog.regions.length,
          sizeCount: catalog.sizes.length,
          imageCount: catalog.images.length,
          catalogItemCount: persisted.catalogItemCount,
          pricedItemCount: persisted.pricedItemCount,
          unavailableItemCount: persisted.unavailableItemCount,
          lastSyncStatus: "SUCCEEDED",
          lastError: persisted.priceContractConfirmed
            ? null
            : "واحد پول Provider تأیید نشده است.",
        },
        create: {
          id: "parspack-v1",
          provider,
          apiVersion: "v1",
          lastCatalogSync: syncedAt,
          regionCount: catalog.regions.length,
          sizeCount: catalog.sizes.length,
          imageCount: catalog.images.length,
          catalogItemCount: persisted.catalogItemCount,
          pricedItemCount: persisted.pricedItemCount,
          unavailableItemCount: persisted.unavailableItemCount,
          lastSyncStatus: "SUCCEEDED",
          lastError: persisted.priceContractConfirmed
            ? null
            : "واحد پول Provider تأیید نشده است.",
        },
      });
    });
    return jsonOk({ state: await publicState(provider) });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/providers/sync]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("همگام‌سازی کاتالوگ ممکن نیست.", 500);
  }
}
