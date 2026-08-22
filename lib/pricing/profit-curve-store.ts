/**
 * Single source of truth for reading the published profit curve.
 *
 * The storefront card price and the quote/checkout price must resolve the
 * provider markup from the same curve. Loading and mapping the curve in more
 * than one place is exactly what let the advertised price drift away from the
 * charged price, so every caller reads it through this function.
 */

import { prisma } from "@/lib/db";
import type { ProfitCurveConfigInput } from "@/lib/pricing/profit-curve";
import { coerceProfitCurveConfig } from "@/lib/pricing/profit-curve-apply";

export async function loadProfitCurveConfiguration(): Promise<ProfitCurveConfigInput> {
  const row = await prisma.profitCurveConfiguration.findUnique({
    where: { id: "default" },
    include: { bands: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) {
    // No published curve means no curve pricing — never fall back to an
    // enabled default, which would silently invent a margin.
    return { ...coerceProfitCurveConfig(null), enabled: false };
  }
  return {
    enabled: row.enabled,
    minimumPostDiscountGrossMarginBps: row.minimumPostDiscountGrossMarginBps,
    bands: row.bands.map((band) => ({
      id: band.id,
      sortOrder: band.sortOrder,
      minProviderCostRial: band.minProviderCostRial,
      maxProviderCostRial: band.maxProviderCostRial,
      targetGrossMarginBps: band.targetGrossMarginBps,
    })),
  };
}
