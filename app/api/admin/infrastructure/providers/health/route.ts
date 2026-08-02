import { InfrastructureProvider } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { toSafeConnectionFailure } from "@/lib/admin/service-connection-safety";
import { prisma } from "@/lib/db";
import {
  createCloudProviderAdapter,
  createInfrastructureProvider,
  isCloudProviderConfigured,
  isProviderConfigured,
} from "@/lib/infrastructure/provider-factory";
import { listProviderSyncRegionCodes } from "@/lib/infrastructure/provider-region-config";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    await requireAdminUser();
    const body = (await request.json().catch(() => ({}))) as {
      provider?: unknown;
    };
    const provider =
      body.provider === InfrastructureProvider.ARVAN ||
      body.provider === InfrastructureProvider.PARSPACK
        ? body.provider
        : null;
    if (!provider) return jsonError("Provider معتبر نیست.", 400);

    const configured =
      provider === InfrastructureProvider.ARVAN
        ? isCloudProviderConfigured(provider)
        : isProviderConfigured();
    const checkedAt = new Date();
    let ok = false;
    let message = "تنظیم نشده";
    let providerRequestId: string | null = null;
    if (configured) {
      if (provider === InfrastructureProvider.ARVAN) {
        const regionCodes = await listProviderSyncRegionCodes(provider, "v1");
        const adapter = createCloudProviderAdapter(provider, "v1", {
          regionCodes,
        });
        const regions = await adapter.syncRegions();
        if (regions[0]) await adapter.syncPlans(regions[0].code);
        ok = regions.length > 0;
        providerRequestId =
          regions.find((region) => region.providerRequestId)
            ?.providerRequestId ?? null;
        message = ok ? "اتصال برقرار است" : "Region فعالی دریافت نشد";
      } else {
        const health = await createInfrastructureProvider().checkConnection();
        ok = health.ok;
        message = health.message;
      }
    }
    const state = await prisma.providerCatalogState.upsert({
      where: { provider },
      update: {
        lastHealthCheck: checkedAt,
        lastProviderRequestId: providerRequestId,
        lastError: ok ? null : message,
      },
      create: {
        id: `${provider.toLowerCase()}-v1`,
        provider,
        apiVersion: "v1",
        lastHealthCheck: checkedAt,
        lastProviderRequestId: providerRequestId,
        lastError: ok ? null : message,
      },
    });
    const pricing = await prisma.providerPricingConfig.findUnique({
      where: { provider },
    });

    return jsonOk({
      state: {
        status: configured ? (ok ? "healthy" : "error") : "unconfigured",
        message,
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
        configured,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    const safe = toSafeConnectionFailure(error);
    console.error(
      JSON.stringify({
        event: "admin_provider_health_check_failed",
        safeErrorCode: safe.code,
      }),
    );
    return jsonError("بررسی اتصال ممکن نیست.", 500);
  }
}
