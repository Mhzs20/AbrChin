/**
 * Tiered profit curve resolver.
 *
 * Converts provider monthly infrastructure cost into an effective provider
 * markup BPS using five Admin-editable target-margin bands with mathematically
 * derived smooth transitions (no hard price cliffs).
 *
 * This module does NOT compute tax, Parchin, add-ons, or checkout totals.
 * Feed `effectiveMarkupBps` into `computeCommercialPriceBreakdown()`.
 */

import {
  BPS_DENOMINATOR,
  grossMarginBpsToMarkupBps,
  markupBpsToGrossMarginBps,
  multiplyBpsRoundUp,
} from "@/lib/pricing/commercial-engine";

/** 1 Toman = 10 Rial (internal money unit). */
export const TOMAN_TO_RIAL = 10n;

export const DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS = 2_000;
export const PROFIT_CURVE_MIN_MARGIN_BPS = 1_000;
export const PROFIT_CURVE_MAX_MARGIN_BPS = 7_500;
export const PROFIT_CURVE_REQUIRED_BAND_COUNT = 5;

export type ProfitCurveBandInput = {
  id?: string;
  sortOrder: number;
  /** Inclusive lower bound in Rial. First band must be 0. */
  minProviderCostRial: bigint;
  /** Exclusive upper bound in Rial. Final band must be null (unbounded). */
  maxProviderCostRial: bigint | null;
  targetGrossMarginBps: number;
};

export type ProfitCurveConfigInput = {
  enabled: boolean;
  minimumPostDiscountGrossMarginBps: number;
  bands: ProfitCurveBandInput[];
};

export type ProfitCurveResolution = {
  targetGrossMarginBps: number;
  effectiveGrossMarginBps: number;
  effectiveMarkupBps: number;
  bandId: string;
  bandIndex: number;
  transition: boolean;
  transitionStartRial: bigint | null;
  transitionEndRial: bigint | null;
  /** Infrastructure sale price implied by the effective margin (monthly). */
  infrastructureSaleRial: bigint;
};

export type ProfitCurveTransition = {
  bandIndex: number;
  boundaryRial: bigint;
  previousMarginBps: number;
  nextMarginBps: number;
  boundarySaleRial: bigint;
  transitionEndRial: bigint;
};

export type ProfitCurveValidationIssue = {
  code: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

/** Default five business bands (Toman thresholds converted to Rial). */
export function defaultProfitCurveBands(): ProfitCurveBandInput[] {
  return [
    {
      id: "band-0-5m",
      sortOrder: 0,
      minProviderCostRial: 0n,
      maxProviderCostRial: 5_000_000n * TOMAN_TO_RIAL,
      targetGrossMarginBps: 7_000,
    },
    {
      id: "band-5-10m",
      sortOrder: 1,
      minProviderCostRial: 5_000_000n * TOMAN_TO_RIAL,
      maxProviderCostRial: 10_000_000n * TOMAN_TO_RIAL,
      targetGrossMarginBps: 6_000,
    },
    {
      id: "band-10-15m",
      sortOrder: 2,
      minProviderCostRial: 10_000_000n * TOMAN_TO_RIAL,
      maxProviderCostRial: 15_000_000n * TOMAN_TO_RIAL,
      targetGrossMarginBps: 5_000,
    },
    {
      id: "band-15-25m",
      sortOrder: 3,
      minProviderCostRial: 15_000_000n * TOMAN_TO_RIAL,
      maxProviderCostRial: 25_000_000n * TOMAN_TO_RIAL,
      targetGrossMarginBps: 4_000,
    },
    {
      id: "band-25m-plus",
      sortOrder: 4,
      minProviderCostRial: 25_000_000n * TOMAN_TO_RIAL,
      maxProviderCostRial: null,
      targetGrossMarginBps: 3_000,
    },
  ];
}

export function defaultProfitCurveConfig(): ProfitCurveConfigInput {
  return {
    enabled: true,
    minimumPostDiscountGrossMarginBps:
      DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS,
    bands: defaultProfitCurveBands(),
  };
}

/**
 * Sale price at a target gross margin using the same markup conversion the
 * commercial engine applies (ceil markup on cost).
 */
export function infrastructureSaleFromMargin(
  providerCostRial: bigint,
  targetGrossMarginBps: number,
): bigint {
  if (providerCostRial < 0n) throw new Error("invalid_provider_cost");
  if (providerCostRial === 0n) return 0n;
  const markupBps = grossMarginBpsToMarkupBps(targetGrossMarginBps);
  return providerCostRial + multiplyBpsRoundUp(providerCostRial, markupBps);
}

/**
 * Pure floor division sale from margin (geometry reference for transitions).
 */
export function boundarySaleFloor(
  boundaryCostRial: bigint,
  previousMarginBps: number,
): bigint {
  if (boundaryCostRial <= 0n) throw new Error("invalid_boundary_cost");
  const keep = BigInt(10_000 - previousMarginBps);
  if (keep <= 0n) throw new Error("invalid_margin");
  return (boundaryCostRial * BPS_DENOMINATOR) / keep;
}

/**
 * Held infrastructure sale at a downward-margin boundary. Takes the max of
 * the geometric floor and commercial-engine sales at B and B−1 so entering
 * the transition never makes a server cheaper than the previous cost point.
 */
export function computeBoundarySaleRial(
  boundaryCostRial: bigint,
  previousMarginBps: number,
): bigint {
  const floorSale = boundarySaleFloor(boundaryCostRial, previousMarginBps);
  const engineAtBoundary = infrastructureSaleFromMargin(
    boundaryCostRial,
    previousMarginBps,
  );
  const engineBefore =
    boundaryCostRial > 1n
      ? infrastructureSaleFromMargin(boundaryCostRial - 1n, previousMarginBps)
      : 0n;
  let held = floorSale;
  if (engineAtBoundary > held) held = engineAtBoundary;
  if (engineBefore > held) held = engineBefore;
  return held;
}

/**
 * transitionEnd starts from B × (1 − M2) / (1 − M1), then nudges upward so
 * the commercial-engine sale at M2 never falls below the held boundary sale.
 */
export function computeTransitionEndRial(
  boundaryCostRial: bigint,
  previousMarginBps: number,
  nextMarginBps: number,
  boundarySaleRial?: bigint,
): bigint {
  if (nextMarginBps > previousMarginBps) {
    throw new Error("invalid_transition_margins");
  }
  if (nextMarginBps === previousMarginBps) {
    return boundaryCostRial;
  }
  const keepPrev = BigInt(10_000 - previousMarginBps);
  const keepNext = BigInt(10_000 - nextMarginBps);
  const geometric = (boundaryCostRial * keepNext) / keepPrev;
  const boundarySale =
    boundarySaleRial ??
    computeBoundarySaleRial(boundaryCostRial, previousMarginBps);
  let end = geometric < boundaryCostRial ? boundaryCostRial : geometric;
  for (let guard = 0; guard < 64; guard += 1) {
    if (infrastructureSaleFromMargin(end, nextMarginBps) >= boundarySale) {
      return end;
    }
    end += 1n;
  }
  return end;
}

export function deriveProfitCurveTransitions(
  bands: ProfitCurveBandInput[],
): ProfitCurveTransition[] {
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  const transitions: ProfitCurveTransition[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    const boundary = next.minProviderCostRial;
    if (next.targetGrossMarginBps > prev.targetGrossMarginBps) {
      throw new Error("ascending_margins");
    }
    if (next.targetGrossMarginBps === prev.targetGrossMarginBps) {
      continue;
    }
    const boundarySale = computeBoundarySaleRial(
      boundary,
      prev.targetGrossMarginBps,
    );
    const transitionEnd = computeTransitionEndRial(
      boundary,
      prev.targetGrossMarginBps,
      next.targetGrossMarginBps,
      boundarySale,
    );
    transitions.push({
      bandIndex: i,
      boundaryRial: boundary,
      previousMarginBps: prev.targetGrossMarginBps,
      nextMarginBps: next.targetGrossMarginBps,
      boundarySaleRial: boundarySale,
      transitionEndRial: transitionEnd,
    });
  }
  return transitions;
}

function bandIdOf(band: ProfitCurveBandInput, index: number): string {
  return band.id ?? `band-${index}`;
}

function findBandIndex(
  bands: ProfitCurveBandInput[],
  providerMonthlyCostRial: bigint,
): number {
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const band = sorted[i]!;
    if (providerMonthlyCostRial >= band.minProviderCostRial) {
      if (
        band.maxProviderCostRial == null ||
        providerMonthlyCostRial < band.maxProviderCostRial ||
        i === sorted.length - 1
      ) {
        return i;
      }
    }
  }
  return 0;
}

/**
 * Effective margin while holding sale price at the boundary sale floor:
 * effectiveMargin = 1 − cost / boundarySale
 */
export function effectiveMarginDuringTransition(
  providerCostRial: bigint,
  boundarySaleRial: bigint,
): number {
  if (boundarySaleRial <= 0n || providerCostRial < 0n) {
    throw new Error("invalid_transition_inputs");
  }
  if (providerCostRial >= boundarySaleRial) {
    throw new Error("cost_exceeds_boundary_sale");
  }
  const profit = boundarySaleRial - providerCostRial;
  return Number((profit * BPS_DENOMINATOR + boundarySaleRial / 2n) / boundarySaleRial);
}

/**
 * Resolve provider cost → target/effective margin → provider markup BPS.
 */
export function resolveProfitCurve(input: {
  providerMonthlyCostRial: bigint;
  bands: ProfitCurveBandInput[];
}): ProfitCurveResolution {
  const { providerMonthlyCostRial, bands } = input;
  if (providerMonthlyCostRial < 0n) throw new Error("invalid_provider_cost");
  if (bands.length === 0) throw new Error("empty_profit_curve");

  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  const transitions = deriveProfitCurveTransitions(sorted);
  const bandIndex = findBandIndex(sorted, providerMonthlyCostRial);
  const band = sorted[bandIndex]!;
  const targetGrossMarginBps = band.targetGrossMarginBps;

  // Active downward-margin transition covering this cost?
  const active = transitions.find(
    (t) =>
      providerMonthlyCostRial >= t.boundaryRial &&
      providerMonthlyCostRial < t.transitionEndRial,
  );

  if (active) {
    const effectiveGrossMarginBps = effectiveMarginDuringTransition(
      providerMonthlyCostRial,
      active.boundarySaleRial,
    );
    // Hold exact boundary sale (constant) for continuity / monotonicity.
    const infrastructureSaleRial = active.boundarySaleRial;
    const desiredMarkup = infrastructureSaleRial - providerMonthlyCostRial;
    const flooredMarkupBps =
      providerMonthlyCostRial > 0n && desiredMarkup > 0n
        ? Number(
            (desiredMarkup * BPS_DENOMINATOR + providerMonthlyCostRial - 1n) /
              providerMonthlyCostRial,
          )
        : grossMarginBpsToMarkupBps(
            Math.min(Math.max(effectiveGrossMarginBps, 0), 9_999),
          );
    return {
      targetGrossMarginBps: active.nextMarginBps,
      effectiveGrossMarginBps,
      effectiveMarkupBps: flooredMarkupBps,
      bandId: bandIdOf(band, bandIndex),
      bandIndex,
      transition: true,
      transitionStartRial: active.boundaryRial,
      transitionEndRial: active.transitionEndRial,
      infrastructureSaleRial,
    };
  }

  const effectiveMarkupBps = grossMarginBpsToMarkupBps(targetGrossMarginBps);
  const infrastructureSaleRial = infrastructureSaleFromMargin(
    providerMonthlyCostRial,
    targetGrossMarginBps,
  );
  return {
    targetGrossMarginBps,
    effectiveGrossMarginBps: targetGrossMarginBps,
    effectiveMarkupBps,
    bandId: bandIdOf(band, bandIndex),
    bandIndex,
    transition: false,
    transitionStartRial: null,
    transitionEndRial: null,
    infrastructureSaleRial,
  };
}

export function serializeProfitCurveConfig(config: ProfitCurveConfigInput) {
  return {
    enabled: config.enabled,
    minimumPostDiscountGrossMarginBps:
      config.minimumPostDiscountGrossMarginBps,
    bands: config.bands
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((band, index) => ({
        id: bandIdOf(band, index),
        sortOrder: band.sortOrder,
        minProviderCostRial: band.minProviderCostRial.toString(),
        maxProviderCostRial:
          band.maxProviderCostRial == null
            ? null
            : band.maxProviderCostRial.toString(),
        targetGrossMarginBps: band.targetGrossMarginBps,
        equivalentMarkupBps: grossMarginBpsToMarkupBps(
          band.targetGrossMarginBps,
        ),
      })),
    transitions: deriveProfitCurveTransitions(config.bands).map((t) => ({
      bandIndex: t.bandIndex,
      boundaryRial: t.boundaryRial.toString(),
      previousMarginBps: t.previousMarginBps,
      nextMarginBps: t.nextMarginBps,
      boundarySaleRial: t.boundarySaleRial.toString(),
      transitionEndRial: t.transitionEndRial.toString(),
    })),
  };
}

export function parseProfitCurveConfig(
  value: unknown,
): ProfitCurveConfigInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const bandsRaw = Array.isArray(raw.bands) ? raw.bands : null;
  if (!bandsRaw) return null;
  const bands: ProfitCurveBandInput[] = bandsRaw.map((row, index) => {
    const item = row as Record<string, unknown>;
    const min = BigInt(String(item.minProviderCostRial ?? "0"));
    const maxRaw = item.maxProviderCostRial;
    const max =
      maxRaw == null || maxRaw === ""
        ? null
        : BigInt(String(maxRaw));
    return {
      id: typeof item.id === "string" ? item.id : `band-${index}`,
      sortOrder: Number.isInteger(Number(item.sortOrder))
        ? Number(item.sortOrder)
        : index,
      minProviderCostRial: min,
      maxProviderCostRial: max,
      targetGrossMarginBps: Number(item.targetGrossMarginBps),
    };
  });
  const floor = Number(raw.minimumPostDiscountGrossMarginBps);
  return {
    enabled: raw.enabled !== false,
    minimumPostDiscountGrossMarginBps: Number.isInteger(floor)
      ? floor
      : DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS,
    bands,
  };
}

/**
 * Structural + geometric validation for publishing a curve.
 * Monotonicity against catalog/synthetic points is a separate check.
 */
export function validateProfitCurveStructure(
  config: ProfitCurveConfigInput,
): ProfitCurveValidationIssue[] {
  const issues: ProfitCurveValidationIssue[] = [];
  const bands = [...config.bands].sort((a, b) => a.sortOrder - b.sortOrder);

  if (bands.length !== PROFIT_CURVE_REQUIRED_BAND_COUNT) {
    issues.push({
      code: "band_count",
      message: `منحنی سود باید دقیقاً ${PROFIT_CURVE_REQUIRED_BAND_COUNT} بازه داشته باشد.`,
      details: { count: bands.length },
    });
  }
  if (
    !Number.isInteger(config.minimumPostDiscountGrossMarginBps) ||
    config.minimumPostDiscountGrossMarginBps < PROFIT_CURVE_MIN_MARGIN_BPS ||
    config.minimumPostDiscountGrossMarginBps > PROFIT_CURVE_MAX_MARGIN_BPS
  ) {
    issues.push({
      code: "discount_floor",
      message: "کف حاشیه پس از تخفیف باید بین ۱۰٪ و ۷۵٪ باشد.",
    });
  }
  if (bands.length === 0) return issues;

  if (bands[0]!.minProviderCostRial !== 0n) {
    issues.push({
      code: "first_band_zero",
      message: "اولین بازه باید از هزینه صفر شروع شود.",
    });
  }
  const last = bands[bands.length - 1]!;
  if (last.maxProviderCostRial != null) {
    issues.push({
      code: "final_band_unbounded",
      message: "آخرین بازه نباید سقف هزینه داشته باشد.",
    });
  }

  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]!;
    if (
      !Number.isInteger(band.targetGrossMarginBps) ||
      band.targetGrossMarginBps < PROFIT_CURVE_MIN_MARGIN_BPS ||
      band.targetGrossMarginBps > PROFIT_CURVE_MAX_MARGIN_BPS
    ) {
      issues.push({
        code: "margin_bounds",
        message: `حاشیه سود بازه ${i + 1} باید بین ۱۰٪ و ۷۵٪ باشد.`,
        details: { bandIndex: i, marginBps: band.targetGrossMarginBps },
      });
    }
    if (band.minProviderCostRial < 0n) {
      issues.push({
        code: "negative_threshold",
        message: `آستانه بازه ${i + 1} نمی‌تواند منفی باشد.`,
        details: { bandIndex: i },
      });
    }
    if (
      band.maxProviderCostRial != null &&
      band.maxProviderCostRial <= band.minProviderCostRial
    ) {
      issues.push({
        code: "band_range",
        message: `بازه ${i + 1} نامعتبر است (سقف باید بزرگ‌تر از کف باشد).`,
        details: { bandIndex: i },
      });
    }
    if (i > 0) {
      const prev = bands[i - 1]!;
      if (band.minProviderCostRial <= prev.minProviderCostRial) {
        issues.push({
          code: "thresholds_not_ascending",
          message: "آستانه‌های هزینه باید اکیداً صعودی باشند.",
          details: { bandIndex: i },
        });
      }
      if (prev.maxProviderCostRial != null &&
          prev.maxProviderCostRial !== band.minProviderCostRial) {
        issues.push({
          code: "band_gap_or_overlap",
          message: "بازه‌ها باید بدون فاصله و همپوشانی به هم متصل باشند.",
          details: { bandIndex: i },
        });
      }
      if (band.targetGrossMarginBps > prev.targetGrossMarginBps) {
        issues.push({
          code: "margins_not_descending",
          message: "حاشیه سود هدف باید نزولی یا مساوی باشد.",
          details: { bandIndex: i },
        });
      }
    }
  }

  try {
    const transitions = deriveProfitCurveTransitions(bands);
    for (const t of transitions) {
      if (t.transitionEndRial <= t.boundaryRial) {
        issues.push({
          code: "invalid_transition",
          message: "طول انتقال خودکار نامعتبر است.",
          details: {
            bandIndex: t.bandIndex,
            boundaryRial: t.boundaryRial.toString(),
            transitionEndRial: t.transitionEndRial.toString(),
          },
        });
      }
      const nextBoundary =
        bands[t.bandIndex + 1]?.minProviderCostRial ?? null;
      // transitionEnd must occur before the *following* tier boundary
      // (the boundary after the band that begins at t.boundaryRial).
      const followingBoundary =
        bands[t.bandIndex + 1] != null
          ? bands[t.bandIndex]!.maxProviderCostRial
          : null;
      // Spec: each transitionEnd occurs before the next following tier boundary.
      // For band i starting at B, following tier boundary is bands[i+1].min.
      const followingTierBoundary =
        t.bandIndex + 1 < bands.length
          ? bands[t.bandIndex + 1]!.minProviderCostRial
          : null;
      void nextBoundary;
      void followingBoundary;
      if (
        followingTierBoundary != null &&
        t.transitionEndRial >= followingTierBoundary
      ) {
        issues.push({
          code: "transition_overlaps_next_boundary",
          message:
            "پایان انتقال خودکار باید قبل از آستانه بازه بعدی باشد.",
          details: {
            bandIndex: t.bandIndex,
            transitionEndRial: t.transitionEndRial.toString(),
            nextBoundaryRial: followingTierBoundary.toString(),
          },
        });
      }
      if (t.boundarySaleRial <= 0n || t.transitionEndRial <= 0n) {
        issues.push({
          code: "non_positive_sale",
          message: "قیمت فروش محاسبه‌شده باید بزرگ‌تر از صفر باشد.",
          details: { bandIndex: t.bandIndex },
        });
      }
    }
  } catch (error) {
    issues.push({
      code: "transition_derive_failed",
      message:
        error instanceof Error
          ? error.message
          : "محاسبه انتقال خودکار ناموفق بود.",
    });
  }

  return issues;
}

/**
 * Sale-price monotonicity over synthetic costs + explicit critical points.
 * Returns actionable failure details for Admin publish.
 */
export function validateProfitCurveMonotonicity(
  bands: ProfitCurveBandInput[],
  options: {
    catalogCostsRial?: bigint[];
    syntheticPoints?: number;
    maxCostRial?: bigint;
  } = {},
): {
  ok: boolean;
  issues: ProfitCurveValidationIssue[];
  sampled: number;
} {
  const issues: ProfitCurveValidationIssue[] = [];
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  const transitions = deriveProfitCurveTransitions(sorted);
  const maxCost =
    options.maxCostRial ??
    (sorted[sorted.length - 1]!.minProviderCostRial * 2n ||
      50_000_000n * TOMAN_TO_RIAL);

  const points = new Set<string>();
  const add = (value: bigint) => {
    if (value >= 0n) points.add(value.toString());
  };

  for (const band of sorted) {
    add(band.minProviderCostRial);
    if (band.minProviderCostRial > 0n) add(band.minProviderCostRial - 1n);
    add(band.minProviderCostRial + 1n);
    if (band.maxProviderCostRial != null) {
      add(band.maxProviderCostRial);
      add(band.maxProviderCostRial - 1n);
    }
  }
  for (const t of transitions) {
    add(t.boundaryRial);
    if (t.boundaryRial > 0n) add(t.boundaryRial - 1n);
    add(t.boundaryRial + 1n);
    add(t.transitionEndRial);
    if (t.transitionEndRial > 0n) add(t.transitionEndRial - 1n);
    add(t.transitionEndRial + 1n);
  }
  for (const cost of options.catalogCostsRial ?? []) add(cost);

  const syntheticCount = Math.max(options.syntheticPoints ?? 2_000, 2);
  if (maxCost > 0n) {
    for (let i = 0; i < syntheticCount; i += 1) {
      const cost =
        (maxCost * BigInt(i)) / BigInt(syntheticCount - 1);
      add(cost === 0n ? 1n : cost);
    }
  }

  const ordered = [...points]
    .map((value) => BigInt(value))
    .filter((value) => value > 0n)
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));

  let previousSale: bigint | null = null;
  let previousCost: bigint | null = null;
  for (const cost of ordered) {
    const resolved = resolveProfitCurve({
      providerMonthlyCostRial: cost,
      bands: sorted,
    });
    // During transition the held boundary sale is authoritative; otherwise use
    // the commercial-engine ceil markup path.
    const sale = resolved.transition
      ? resolved.infrastructureSaleRial
      : cost + multiplyBpsRoundUp(cost, resolved.effectiveMarkupBps);
    if (sale <= 0n) {
      issues.push({
        code: "non_positive_sale",
        message: "قیمت فروش سرور باید بزرگ‌تر از صفر باشد.",
        details: { costRial: cost.toString(), saleRial: sale.toString() },
      });
    }
    if (previousSale != null && sale < previousSale) {
      issues.push({
        code: "sale_not_monotonic",
        message:
          "با افزایش هزینه خرید، قیمت فروش مشتری نباید کاهش یابد.",
        details: {
          previousCostRial: previousCost!.toString(),
          previousSaleRial: previousSale.toString(),
          costRial: cost.toString(),
          saleRial: sale.toString(),
        },
      });
      if (issues.length >= 25) break;
    }
    previousSale = sale;
    previousCost = cost;
  }

  return {
    ok: issues.length === 0,
    issues,
    sampled: ordered.length,
  };
}

/** Equivalent sale multiplier display: sale / cost (×100 for percent UI). */
export function saleMultiplierBpsFromMargin(marginBps: number): number {
  const markup = grossMarginBpsToMarkupBps(marginBps);
  return 10_000 + markup;
}

export function describeDefaultTransitionRanges() {
  const bands = defaultProfitCurveBands();
  const transitions = deriveProfitCurveTransitions(bands);
  return transitions.map((t) => ({
    boundaryToman: Number(t.boundaryRial / TOMAN_TO_RIAL),
    transitionEndToman: Number(t.transitionEndRial / TOMAN_TO_RIAL),
    fromMarginBps: t.previousMarginBps,
    toMarginBps: t.nextMarginBps,
  }));
}

export { markupBpsToGrossMarginBps, grossMarginBpsToMarkupBps };
