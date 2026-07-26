import { InfrastructureProvider } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { createInfrastructureProvider, isProviderConfigured } from "@/lib/infrastructure/provider-factory";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    await requireAdminUser();
    if (!isProviderConfigured()) {
      return jsonError("ParsPack تنظیم نشده است.", 400);
    }

    const provider = createInfrastructureProvider();
    const catalog = await provider.syncCatalog();
    const state = await prisma.providerCatalogState.upsert({
      where: { provider: InfrastructureProvider.PARSPACK },
      update: {
        lastCatalogSync: new Date(),
        regionCount: catalog.regions.length,
        sizeCount: catalog.sizes.length,
        imageCount: catalog.images.length,
        lastError: null,
      },
      create: {
        id: "parspack",
        provider: InfrastructureProvider.PARSPACK,
        lastCatalogSync: new Date(),
        regionCount: catalog.regions.length,
        sizeCount: catalog.sizes.length,
        imageCount: catalog.images.length,
      },
    });

    return jsonOk({
      state: {
        status: "healthy",
        message: "همگام‌سازی انجام شد",
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
    console.error("[admin/providers/sync]", error instanceof Error ? error.message : "unknown");
    return jsonError("همگام‌سازی کاتالوگ ممکن نیست.", 500);
  }
}
