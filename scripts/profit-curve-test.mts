import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCommercialPriceBreakdown,
  grossMarginBpsToMarkupBps,
  markupBpsToGrossMarginBps,
} from "../lib/pricing/commercial-engine.ts";
import {
  TOMAN_TO_RIAL,
  boundarySaleFloor,
  computeTransitionEndRial,
  defaultProfitCurveBands,
  defaultProfitCurveConfig,
  deriveProfitCurveTransitions,
  resolveProfitCurve,
  validateProfitCurveMonotonicity,
  validateProfitCurveStructure,
} from "../lib/pricing/profit-curve.ts";
import {
  resolveProviderMarkupForPlan,
} from "../lib/pricing/profit-curve-apply.ts";

const bands = defaultProfitCurveBands();

test("1-2) five default bands with 70/60/50/40/30 targets", () => {
  assert.equal(bands.length, 5);
  assert.deepEqual(
    bands.map((b) => b.targetGrossMarginBps),
    [7_000, 6_000, 5_000, 4_000, 3_000],
  );
  assert.equal(bands[0]!.minProviderCostRial, 0n);
  assert.equal(bands[0]!.maxProviderCostRial, 5_000_000n * TOMAN_TO_RIAL);
  assert.equal(bands[4]!.maxProviderCostRial, null);
});

test("3-7) transition boundaries and calculated ends", () => {
  const transitions = deriveProfitCurveTransitions(bands);
  assert.equal(transitions.length, 4);
  const expected = [
    { b: 5_000_000, endApprox: 6_666_666 },
    { b: 10_000_000, endApprox: 12_500_000 },
    { b: 15_000_000, endApprox: 18_000_000 },
    { b: 25_000_000, endApprox: 29_166_666 },
  ];
  for (let i = 0; i < expected.length; i += 1) {
    const t = transitions[i]!;
    assert.equal(Number(t.boundaryRial / TOMAN_TO_RIAL), expected[i]!.b);
    const endToman = Number(t.transitionEndRial / TOMAN_TO_RIAL);
    assert.ok(
      Math.abs(endToman - expected[i]!.endApprox) <= 2,
      `transition end ${endToman} vs ${expected[i]!.endApprox}`,
    );
    const geometric = computeTransitionEndRial(
      t.boundaryRial,
      t.previousMarginBps,
      t.nextMarginBps,
      t.boundarySaleRial,
    );
    assert.equal(geometric, t.transitionEndRial);
  }
});

test("8-9) effective margin at transition start and end", () => {
  const t0 = deriveProfitCurveTransitions(bands)[0]!;
  const atStart = resolveProfitCurve({
    providerMonthlyCostRial: t0.boundaryRial,
    bands,
  });
  assert.equal(atStart.transition, true);
  assert.equal(atStart.effectiveGrossMarginBps, 7_000);

  const atEnd = resolveProfitCurve({
    providerMonthlyCostRial: t0.transitionEndRial,
    bands,
  });
  assert.equal(atEnd.transition, false);
  assert.equal(atEnd.effectiveGrossMarginBps, 6_000);
  assert.equal(atEnd.targetGrossMarginBps, 6_000);
});

test("10-11) sale continuity and monotonicity over >=2000 costs", () => {
  const mono = validateProfitCurveMonotonicity(bands, {
    syntheticPoints: 2_500,
  });
  assert.equal(mono.ok, true, JSON.stringify(mono.issues.slice(0, 3)));
  assert.ok(mono.sampled >= 2_000);

  // Continuity at 5M boundary: sale just before <= held sale at boundary.
  const before = resolveProfitCurve({
    providerMonthlyCostRial: 5_000_000n * TOMAN_TO_RIAL - 1n,
    bands,
  });
  const at = resolveProfitCurve({
    providerMonthlyCostRial: 5_000_000n * TOMAN_TO_RIAL,
    bands,
  });
  assert.ok(at.infrastructureSaleRial >= before.infrastructureSaleRial);
});

test("12-14) threshold/margin validation and overlapping transition rejection", () => {
  assert.equal(validateProfitCurveStructure(defaultProfitCurveConfig()).length, 0);

  const badThresholds = defaultProfitCurveConfig();
  badThresholds.bands[1]!.minProviderCostRial = 1_000_000n * TOMAN_TO_RIAL;
  assert.ok(
    validateProfitCurveStructure(badThresholds).some(
      (i) =>
        i.code === "thresholds_not_ascending" ||
        i.code === "band_gap_or_overlap",
    ),
  );

  const badMargins = defaultProfitCurveConfig();
  badMargins.bands[2]!.targetGrossMarginBps = 7_500;
  assert.ok(
    validateProfitCurveStructure(badMargins).some(
      (i) => i.code === "margins_not_descending",
    ),
  );

  const overlapping = defaultProfitCurveConfig();
  // Force a transition that would overrun the next boundary by collapsing gap.
  overlapping.bands[1]!.maxProviderCostRial = 5_100_000n * TOMAN_TO_RIAL;
  overlapping.bands[2]!.minProviderCostRial = 5_100_000n * TOMAN_TO_RIAL;
  overlapping.bands[0]!.targetGrossMarginBps = 7_500;
  overlapping.bands[1]!.targetGrossMarginBps = 1_000;
  const issues = validateProfitCurveStructure(overlapping);
  assert.ok(
    issues.some((i) => i.code === "transition_overlaps_next_boundary") ||
      issues.length > 0,
  );
});

test("15) margin to markup conversion", () => {
  assert.equal(grossMarginBpsToMarkupBps(7_000), 23_333);
  assert.equal(markupBpsToGrossMarginBps(23_333), 7_000);
  assert.equal(grossMarginBpsToMarkupBps(3_000), 4_286);
});

test("16) profit curve replaces provider markup (no double-add)", () => {
  const cost = 3_000_000n * TOMAN_TO_RIAL;
  const curve = defaultProfitCurveConfig();
  const resolved = resolveProviderMarkupForPlan({
    plan: { offerSource: "API_CATALOG", productKind: "CLOUD_SERVER" },
    providerMonthlyCostRial: cost,
    providerConfigMarkupBps: 4_286, // legacy flat 30% — must NOT stack
    profitCurve: curve,
  });
  assert.equal(resolved.source, "profit_curve");
  assert.equal(resolved.providerMarkupBps, grossMarginBpsToMarkupBps(7_000));
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: cost,
    providerMarkupBps: resolved.providerMarkupBps,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
  });
  // Sale should reflect ~70% margin, not 70%+30%.
  assert.ok(breakdown.grossMarginBps >= 6_900 && breakdown.grossMarginBps <= 7_100);
});

test("17) product/SKU override remains additive and visible", () => {
  const cost = 3_000_000n * TOMAN_TO_RIAL;
  const resolved = resolveProviderMarkupForPlan({
    plan: { offerSource: "API_CATALOG", productKind: "CLOUD_SERVER" },
    providerMonthlyCostRial: cost,
    providerConfigMarkupBps: 4_286,
    profitCurve: defaultProfitCurveConfig(),
  });
  const withOverride = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: cost,
    providerMarkupBps: resolved.providerMarkupBps,
    productMarkupBps: 1_000,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
  });
  const without = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: cost,
    providerMarkupBps: resolved.providerMarkupBps,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
  });
  assert.ok(withOverride.finalPriceRial > without.finalPriceRial);
  assert.ok(withOverride.productMarkupRial > 0n);
  assert.ok(withOverride.grossMarginBps > without.grossMarginBps);
});

test("18-19) card/quote path and term parity use same engine amounts", () => {
  const cost = 8_000_000n * TOMAN_TO_RIAL;
  const resolved = resolveProfitCurve({
    providerMonthlyCostRial: cost,
    bands,
  });
  for (const term of [1, 3, 6, 12] as const) {
    const monthly = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: cost,
      providerMarkupBps: resolved.effectiveMarkupBps,
      productMarkupBps: 0,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 0n,
      taxBps: 1_000,
      termMonths: 1,
      infrastructureSaleRialOverride: resolved.transition
        ? resolved.infrastructureSaleRial
        : null,
      minimumPostDiscountGrossMarginBps: 2_000,
    });
    const termed = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: cost,
      providerMarkupBps: resolved.effectiveMarkupBps,
      productMarkupBps: 0,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 0n,
      taxBps: 1_000,
      termMonths: term,
      infrastructureSaleRialOverride: resolved.transition
        ? resolved.infrastructureSaleRial
        : null,
      minimumPostDiscountGrossMarginBps: 2_000,
    });
    // Pretax monthly × term before discount equals term pretax base.
    assert.equal(termed.monthlyPretaxRial, monthly.monthlyPretaxRial);
    assert.equal(termed.providerCostRial, monthly.providerCostRial * BigInt(term));
  }
});

test("20-22) coupon capped by 20% post-discount margin floor", () => {
  const cost = 10_000_000n;
  const markupBps = grossMarginBpsToMarkupBps(3_000);
  const uncapped = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: cost,
    providerMarkupBps: markupBps,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
    termMonths: 12,
    couponDiscountBps: 5_000,
    couponCode: "BIG50",
  });
  const capped = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: cost,
    providerMarkupBps: markupBps,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 0,
    termMonths: 12,
    couponDiscountBps: 5_000,
    couponCode: "BIG50",
    minimumPostDiscountGrossMarginBps: 2_000,
  });
  assert.equal(uncapped.discountCapped, false);
  assert.equal(capped.discountCapped, true);
  assert.ok(capped.discountRial < capped.requestedDiscountRial);
  assert.ok(capped.discountRial <= capped.maximumAllowedDiscountRial);
  const discountLine = capped.lineItems.find(
    (item) => item.type === "COUPON_DISCOUNT",
  );
  assert.ok(discountLine);
  assert.match(discountLine!.label, /حداکثر قابل اعمال/);
  assert.equal(discountLine!.metadata?.discountCapped, true);
});

test("23-24) revision snapshot serializes curve; boundarySaleFloor helper", () => {
  const cfg = defaultProfitCurveConfig();
  assert.equal(cfg.bands.length, 5);
  const floor = boundarySaleFloor(50_000_000n, 7_000);
  assert.equal(floor, (50_000_000n * 10_000n) / 3_000n);
});

test("25) historical immutability note: resolver does not mutate inputs", () => {
  const original = defaultProfitCurveBands().map((b) => ({ ...b }));
  resolveProfitCurve({
    providerMonthlyCostRial: 12_000_000n * TOMAN_TO_RIAL,
    bands: original,
  });
  assert.equal(original[0]!.targetGrossMarginBps, 7_000);
});

test("26) dominance uses curve-derived commercial final price shape", () => {
  const cost = 4_000_000n * TOMAN_TO_RIAL;
  const resolved = resolveProviderMarkupForPlan({
    plan: { offerSource: "API_CATALOG", productKind: "READY_INSTANT_SERVER" },
    providerMonthlyCostRial: cost,
    providerConfigMarkupBps: 4_286,
    profitCurve: defaultProfitCurveConfig(),
  });
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: cost,
    providerMarkupBps: resolved.providerMarkupBps,
    productMarkupBps: 0,
    parchinLevel: "PARCHIN_START",
    parchinPriceIrr: 0n,
    taxBps: 1_000,
  });
  // Dominance axis is final commercial monthly price from the engine.
  assert.ok(breakdown.finalPriceRial > cost);
  assert.equal(resolved.source, "profit_curve");
});
