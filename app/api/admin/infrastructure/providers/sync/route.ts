import { InfrastructureProvider } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { persistProviderCatalog } from "@/lib/infrastructure/catalog-service";
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
    const syncedAt = new Date();
    try {
      const catalog = await provider.syncCatalog();
      const { state, markupBasisPoints, mapping } = await prisma.$transaction(
        async (tx) => {
          const persisted = await persistProviderCatalog(tx, catalog, syncedAt);
          const state = await tx.providerCatalogState.upsert({
            where: { provider: InfrastructureProvider.PARSPACK },
            update: {
              lastCatalogSync: syncedAt,
              regionCount: catalog.regions.length,
              sizeCount: catalog.sizes.length,
              imageCount: catalog.images.length,
              catalogItemCount: persisted.catalogItemCount,
              pricedItemCount: persisted.pricedItemCount,
              unavailableItemCount: persisted.unavailableItemCount,
              lastError: persisted.priceContractConfirmed
                ? null
                : "واحد و ارز قیمت Provider هنوز با قرارداد رسمی تأیید نشده است.",
            },
            create: {
              id: "parspack",
              provider: InfrastructureProvider.PARSPACK,
              lastCatalogSync: syncedAt,
              regionCount: catalog.regions.length,
              sizeCount: catalog.sizes.length,
              imageCount: catalog.images.length,
              catalogItemCount: persisted.catalogItemCount,
              pricedItemCount: persisted.pricedItemCount,
              unavailableItemCount: persisted.unavailableItemCount,
              lastError: persisted.priceContractConfirmed
                ? null
                : "واحد و ارز قیمت Provider هنوز با قرارداد رسمی تأیید نشده است.",
            },
          });
          const pricing = await tx.providerPricingConfig.findUniqueOrThrow({
            where: { provider: InfrastructureProvider.PARSPACK },
          });
          return {
            state,
            markupBasisPoints: pricing.markupBasisPoints,
            mapping: persisted,
          };
        },
      );

      return jsonOk({
        state: {
          status: state.lastError ? "warning" : "healthy",
          message: state.lastError
            ? "کاتالوگ ذخیره شد؛ قرارداد قیمت ناقص است"
            : "کاتالوگ و قیمت‌ها ذخیره شدند",
          lastHealthCheck: state.lastHealthCheck?.toISOString() ?? null,
          lastCatalogSync: state.lastCatalogSync?.toISOString() ?? null,
          regionCount: state.regionCount,
          sizeCount: state.sizeCount,
          imageCount: state.imageCount,
          catalogItemCount: state.catalogItemCount,
          pricedItemCount: state.pricedItemCount,
          unavailableItemCount: state.unavailableItemCount,
          markupBasisPoints,
          lastError: state.lastError,
          configured: true,
          mappedPlanCount: mapping.mappedPlanCount,
          unmappedPlanCount: mapping.unmappedPlanCount,
        },
      });
    } catch {
      await prisma.providerCatalogState.upsert({
        where: { provider: InfrastructureProvider.PARSPACK },
        update: { lastError: "دریافت یا ذخیره کاتالوگ ناموفق بود." },
        create: {
          id: "parspack",
          provider: InfrastructureProvider.PARSPACK,
          lastError: "دریافت یا ذخیره کاتالوگ ناموفق بود.",
        },
      });
      return jsonError("همگام‌سازی کاتالوگ ممکن نیست.", 502);
    }
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/providers/sync]", error instanceof Error ? error.message : "unknown");
    return jsonError("همگام‌سازی کاتالوگ ممکن نیست.", 500);
  }
}
