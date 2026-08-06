import type { StorefrontAssortmentStyle, StorefrontChinishTier } from "@prisma/client";

export type StorefrontTierPriceBand = {
  minMonthlyPriceRial: bigint;
  /** null = no upper bound */
  maxMonthlyPriceRial: bigint | null;
};

export type StorefrontPriceBands = Record<
  StorefrontChinishTier,
  StorefrontTierPriceBand
>;

export const DEFAULT_STOREFRONT_PRICE_BANDS: StorefrontPriceBands = {
  NO: { minMonthlyPriceRial: 0n, maxMonthlyPriceRial: null },
  OSTOVAR: { minMonthlyPriceRial: 0n, maxMonthlyPriceRial: null },
  KAHKESHAN: { minMonthlyPriceRial: 0n, maxMonthlyPriceRial: null },
};

export const DEFAULT_STOREFRONT_ASSORTMENT_STYLE: StorefrontAssortmentStyle =
  "CHEAPEST";

export function offerMatchesTierPriceBand(
  monthlyPriceRial: bigint,
  band: StorefrontTierPriceBand,
) {
  if (monthlyPriceRial < band.minMonthlyPriceRial) return false;
  if (
    band.maxMonthlyPriceRial != null &&
    monthlyPriceRial > band.maxMonthlyPriceRial
  ) {
    return false;
  }
  return true;
}

function readNonNegBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`storefront_invalid_price_band:${field}`);
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`storefront_invalid_price_band:${field}`);
}

function readMaxBigInt(value: unknown, field: string): bigint | null {
  if (value == null || value === "") return null;
  return readNonNegBigInt(value, field);
}

/** Admin UI uses تومان integers; storage is Rial. */
export function tomanToRial(toman: number | bigint): bigint {
  const value = typeof toman === "bigint" ? toman : BigInt(toman);
  if (value < 0n) throw new Error("storefront_invalid_price_band:toman");
  return value * 10n;
}

export function rialToTomanNumber(rial: bigint): number {
  const toman = rial / 10n;
  if (toman > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(toman);
}

export function parseStorefrontPriceBands(input: {
  noMinMonthlyPriceRial?: unknown;
  noMaxMonthlyPriceRial?: unknown;
  ostovarMinMonthlyPriceRial?: unknown;
  ostovarMaxMonthlyPriceRial?: unknown;
  kahkeshanMinMonthlyPriceRial?: unknown;
  kahkeshanMaxMonthlyPriceRial?: unknown;
}): StorefrontPriceBands {
  const bands: StorefrontPriceBands = {
    NO: {
      minMonthlyPriceRial: readNonNegBigInt(
        input.noMinMonthlyPriceRial ?? 0,
        "noMin",
      ),
      maxMonthlyPriceRial: readMaxBigInt(input.noMaxMonthlyPriceRial, "noMax"),
    },
    OSTOVAR: {
      minMonthlyPriceRial: readNonNegBigInt(
        input.ostovarMinMonthlyPriceRial ?? 0,
        "ostovarMin",
      ),
      maxMonthlyPriceRial: readMaxBigInt(
        input.ostovarMaxMonthlyPriceRial,
        "ostovarMax",
      ),
    },
    KAHKESHAN: {
      minMonthlyPriceRial: readNonNegBigInt(
        input.kahkeshanMinMonthlyPriceRial ?? 0,
        "kahkeshanMin",
      ),
      maxMonthlyPriceRial: readMaxBigInt(
        input.kahkeshanMaxMonthlyPriceRial,
        "kahkeshanMax",
      ),
    },
  };
  for (const tier of ["NO", "OSTOVAR", "KAHKESHAN"] as const) {
    const band = bands[tier];
    if (
      band.maxMonthlyPriceRial != null &&
      band.maxMonthlyPriceRial < band.minMonthlyPriceRial
    ) {
      throw new Error("storefront_price_band_order_invalid");
    }
  }
  return bands;
}

export function parseStorefrontAssortmentStyle(
  value: unknown,
): StorefrontAssortmentStyle {
  if (value === "CHEAPEST" || value === "STRONGEST") return value;
  throw new Error("storefront_invalid_assortment_style");
}

export function priceBandsToDbFields(bands: StorefrontPriceBands) {
  return {
    noMinMonthlyPriceRial: bands.NO.minMonthlyPriceRial,
    noMaxMonthlyPriceRial: bands.NO.maxMonthlyPriceRial,
    ostovarMinMonthlyPriceRial: bands.OSTOVAR.minMonthlyPriceRial,
    ostovarMaxMonthlyPriceRial: bands.OSTOVAR.maxMonthlyPriceRial,
    kahkeshanMinMonthlyPriceRial: bands.KAHKESHAN.minMonthlyPriceRial,
    kahkeshanMaxMonthlyPriceRial: bands.KAHKESHAN.maxMonthlyPriceRial,
  };
}

export function priceBandsFromSettings(settings: {
  noMinMonthlyPriceRial: bigint;
  noMaxMonthlyPriceRial: bigint | null;
  ostovarMinMonthlyPriceRial: bigint;
  ostovarMaxMonthlyPriceRial: bigint | null;
  kahkeshanMinMonthlyPriceRial: bigint;
  kahkeshanMaxMonthlyPriceRial: bigint | null;
}): StorefrontPriceBands {
  return {
    NO: {
      minMonthlyPriceRial: settings.noMinMonthlyPriceRial,
      maxMonthlyPriceRial: settings.noMaxMonthlyPriceRial,
    },
    OSTOVAR: {
      minMonthlyPriceRial: settings.ostovarMinMonthlyPriceRial,
      maxMonthlyPriceRial: settings.ostovarMaxMonthlyPriceRial,
    },
    KAHKESHAN: {
      minMonthlyPriceRial: settings.kahkeshanMinMonthlyPriceRial,
      maxMonthlyPriceRial: settings.kahkeshanMaxMonthlyPriceRial,
    },
  };
}

export function compareOffersByAssortmentStyle(
  a: {
    salePriceRial: string;
    vcpu: number | null;
    ramGb: number | null;
    storageGb: number | null;
  },
  b: {
    salePriceRial: string;
    vcpu: number | null;
    ramGb: number | null;
    storageGb: number | null;
  },
  style: StorefrontAssortmentStyle,
) {
  const priceA = BigInt(a.salePriceRial || "0");
  const priceB = BigInt(b.salePriceRial || "0");
  const powerA = (a.vcpu ?? 0) * 1000 + (a.ramGb ?? 0) * 10 + (a.storageGb ?? 0);
  const powerB = (b.vcpu ?? 0) * 1000 + (b.ramGb ?? 0) * 10 + (b.storageGb ?? 0);
  if (style === "STRONGEST") {
    if (powerA !== powerB) return powerB - powerA;
    if (priceA === priceB) return 0;
    return priceA < priceB ? -1 : 1;
  }
  if (priceA === priceB) {
    return powerB - powerA;
  }
  return priceA < priceB ? -1 : 1;
}
