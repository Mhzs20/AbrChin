import { InfrastructureProvider } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { createInfrastructureProvider, isProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

async function updateCatalogState(partial: {
  lastHealthCheck?: Date;
  lastCatalogSync?: Date;
  regionCount?: number;
  sizeCount?: number;
  imageCount?: number;
  lastError?: string | null;
}) {
  return prisma.providerCatalogState.upsert({
    where: { provider: InfrastructureProvider.PARSPACK },
    update: partial,
    create: {
      id: "parspack",
      provider: InfrastructureProvider.PARSPACK,
      ...partial,
    },
  });
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    await requireAdminUser();
    if (!isProviderConfigured()) {
      const state = await updateCatalogState({
        lastHealthCheck: new Date(),
        lastError: "Provider not configured",
      });
      return jsonOk({
        state: {
          status: "unconfigured",
          message: "تنظیم نشده",
          lastHealthCheck: state.lastHealthCheck?.toISOString() ?? null,
          lastCatalogSync: state.lastCatalogSync?.toISOString() ?? null,
          regionCount: state.regionCount,
          sizeCount: state.sizeCount,
          imageCount: state.imageCount,
          lastError: state.lastError,
          configured: false,
        },
      });
    }

    const provider = createInfrastructureProvider();
    const health = await provider.checkConnection();
    const state = await updateCatalogState({
      lastHealthCheck: health.checkedAt,
      lastError: health.ok ? null : health.message,
    });

    return jsonOk({
      state: {
        status: health.ok ? "healthy" : "error",
        message: health.message,
        lastHealthCheck: state.lastHealthCheck?.toISOString() ?? null,
        lastCatalogSync: state.lastCatalogSync?.toISOString() ?? null,
        regionCount: state.regionCount,
        sizeCount: state.sizeCount,
        imageCount: state.imageCount,
        lastError: state.lastError,
        configured: true,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/providers/health]", error instanceof Error ? error.message : "unknown");
    return jsonError("بررسی اتصال ممکن نیست.", 500);
  }
}
