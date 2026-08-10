/**
 * Independent adversarial regression tests for the financial audit.
 * Do not trust implementer-authored happy-path coverage alone.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  computeCommercialPriceBreakdown,
  grossMarginBpsToMarkupBps,
  multiplyBpsRoundUp,
} from "../lib/pricing/commercial-engine.ts";
import {
  TOMAN_TO_RIAL,
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
import { csvEscape } from "../lib/accounting/reports.ts";
import { recognitionFraction } from "../lib/accounting/kpis.ts";

const bands = defaultProfitCurveBands();
const transitions = deriveProfitCurveTransitions(bands);

test("audit: default transition ends match independent geometry", () => {
  const expected = [
    { b: 5_000_000n * TOMAN_TO_RIAL, end: 66_666_667n },
    { b: 10_000_000n * TOMAN_TO_RIAL, end: 125_000_000n },
    { b: 15_000_000n * TOMAN_TO_RIAL, end: 180_000_000n },
    { b: 25_000_000n * TOMAN_TO_RIAL, end: 291_666_666n },
  ];
  assert.equal(transitions.length, 4);
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(transitions[i]!.boundaryRial, expected[i]!.b);
    assert.equal(transitions[i]!.transitionEndRial, expected[i]!.end);
  }
});

test("audit: boundary ±1 and transitionEnd ±1 for all four boundaries", () => {
  for (const t of transitions) {
    for (const cost of [
      t.boundaryRial - 1n,
      t.boundaryRial,
      t.boundaryRial + 1n,
      t.transitionEndRial - 1n,
      t.transitionEndRial,
      t.transitionEndRial + 1n,
    ]) {
      if (cost <= 0n) continue;
      const resolved = resolveProfitCurve({
        providerMonthlyCostRial: cost,
        bands,
      });
      assert.ok(resolved.infrastructureSaleRial > cost);
      if (cost >= t.boundaryRial && cost < t.transitionEndRial) {
        assert.equal(resolved.transition, true);
        assert.equal(resolved.infrastructureSaleRial, t.boundarySaleRial);
      }
      if (cost === t.transitionEndRial) {
        assert.equal(resolved.transition, false);
      }
    }
  }
});

test("audit: monotonicity over >=10000 synthetic costs + contiguous edges", () => {
  const mono = validateProfitCurveMonotonicity(bands, {
    syntheticPoints: 10_000,
    maxCostRial: 80_000_000n * TOMAN_TO_RIAL,
  });
  assert.equal(mono.ok, true, JSON.stringify(mono.issues.slice(0, 3)));
  assert.ok(mono.sampled >= 10_000);

  // Contiguous one-Rial scans around both edges of each transition. Scanning
  // the entire multi-million-Rial transition would add no edge coverage and
  // makes the release suite needlessly slow.
  for (const t of transitions) {
    for (const edge of [t.boundaryRial, t.transitionEndRial]) {
      let previous: bigint | null = null;
      const start = edge > 250n ? edge - 250n : 1n;
      for (let cost = start; cost <= edge + 250n; cost += 1n) {
        const sale = resolveProfitCurve({
          providerMonthlyCostRial: cost,
          bands,
        }).infrastructureSaleRial;
        if (previous != null) {
          assert.ok(
            sale >= previous,
            `reversal at ${cost}: ${sale} < ${previous}`,
          );
        }
        previous = sale;
      }
    }
  }
});

test("audit: Product markup and SKU override inside every transition", () => {
  for (const t of transitions) {
    const mid =
      t.boundaryRial + (t.transitionEndRial - t.boundaryRial) / 2n;
    const resolved = resolveProviderMarkupForPlan({
      plan: { offerSource: "API_CATALOG", productKind: "CLOUD_SERVER" },
      providerMonthlyCostRial: mid,
      providerConfigMarkupBps: 4_286,
      profitCurve: defaultProfitCurveConfig(),
    });
    assert.equal(resolved.source, "profit_curve");
    assert.equal(resolved.curve?.transition, true);
    assert.ok(resolved.infrastructureSaleRialOverride != null);

    const without = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: mid,
      providerMarkupBps: resolved.providerMarkupBps,
      productMarkupBps: 0,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 1_000_000n,
      taxBps: 1_000,
      infrastructureSaleRialOverride: resolved.infrastructureSaleRialOverride,
      minimumPostDiscountGrossMarginBps: 2_000,
    });
    const withProduct = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: mid,
      providerMarkupBps: resolved.providerMarkupBps,
      productMarkupBps: 1_000,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 1_000_000n,
      taxBps: 1_000,
      infrastructureSaleRialOverride: resolved.infrastructureSaleRialOverride,
      minimumPostDiscountGrossMarginBps: 2_000,
    });
    const withSku = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: mid,
      providerMarkupBps: resolved.providerMarkupBps,
      productMarkupBps: 2_500,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 1_000_000n,
      taxBps: 1_000,
      infrastructureSaleRialOverride: resolved.infrastructureSaleRialOverride,
      minimumPostDiscountGrossMarginBps: 2_000,
    });

    const expectedProduct = multiplyBpsRoundUp(mid, 1_000);
    const expectedSku = multiplyBpsRoundUp(mid, 2_500);
    assert.equal(withProduct.productMarkupRial, expectedProduct);
    assert.equal(withSku.productMarkupRial, expectedSku);
    assert.ok(withProduct.finalPriceRial > without.finalPriceRial);
    assert.ok(withSku.finalPriceRial > withProduct.finalPriceRial);
    // Curve override must not be applied twice / stacked with old provider markup.
    assert.equal(
      without.providerMarkupRial,
      resolved.infrastructureSaleRialOverride! - mid,
    );
  }
});

test("audit: no double markup — curve replaces provider config markup", () => {
  for (const productKind of [
    "CLOUD_SERVER",
    "READY_INSTANT_SERVER",
  ] as const) {
    const cost = 3_000_000n * TOMAN_TO_RIAL;
    const resolved = resolveProviderMarkupForPlan({
      plan: { offerSource: "API_CATALOG", productKind },
      providerMonthlyCostRial: cost,
      providerConfigMarkupBps: 4_286,
      profitCurve: defaultProfitCurveConfig(),
    });
    assert.equal(resolved.providerMarkupBps, grossMarginBpsToMarkupBps(7_000));
    assert.equal(resolved.infrastructureSaleRialOverride, null);
  }

  const manual = resolveProviderMarkupForPlan({
    plan: { offerSource: "MANUAL_ADMIN", productKind: "CLOUD_SERVER" },
    providerMonthlyCostRial: 3_000_000n * TOMAN_TO_RIAL,
    providerConfigMarkupBps: 4_286,
    profitCurve: defaultProfitCurveConfig(),
    manualAdmin: true,
  });
  assert.equal(manual.source, "manual_zero");
  assert.equal(manual.providerMarkupBps, 0);

  const disabled = resolveProviderMarkupForPlan({
    plan: { offerSource: "API_CATALOG", productKind: "CLOUD_SERVER" },
    providerMonthlyCostRial: 3_000_000n * TOMAN_TO_RIAL,
    providerConfigMarkupBps: 4_286,
    profitCurve: { ...defaultProfitCurveConfig(), enabled: false },
  });
  assert.equal(disabled.source, "provider_config");
  assert.equal(disabled.providerMarkupBps, 4_286);
});

test("audit: large coupons capped by 20% floor across bands and terms", () => {
  const sampleCosts = [
    1_000_000n * TOMAN_TO_RIAL,
    5_000_000n * TOMAN_TO_RIAL + 100n,
    12_600_000n * TOMAN_TO_RIAL,
    20_000_000n * TOMAN_TO_RIAL,
    40_000_000n * TOMAN_TO_RIAL,
  ];
  for (const cost of sampleCosts) {
    const curve = resolveProfitCurve({ providerMonthlyCostRial: cost, bands });
    for (const term of [1, 3, 6, 12] as const) {
      for (const coupon of [500, 2_000, 5_000, 9_000, 10_000]) {
        const breakdown = computeCommercialPriceBreakdown({
          providerMonthlyPriceIrr: cost,
          providerMarkupBps: curve.effectiveMarkupBps,
          productMarkupBps: 500,
          parchinLevel: "PARCHIN_START",
          parchinPriceIrr: 2_000_000n,
          taxBps: 1_000,
          termMonths: term,
          couponDiscountBps: coupon,
          couponCode: "HUGE",
          infrastructureSaleRialOverride: curve.transition
            ? curve.infrastructureSaleRial
            : null,
          minimumPostDiscountGrossMarginBps: 2_000,
        });
        assert.ok(breakdown.discountRial <= breakdown.maximumAllowedDiscountRial);
        assert.equal(
          breakdown.finalPriceRial,
          breakdown.taxableRial + breakdown.taxRial,
        );
        if (breakdown.discountCapped) {
          assert.equal(
            breakdown.discountRial,
            breakdown.maximumAllowedDiscountRial,
          );
          const line = breakdown.lineItems.find(
            (item) => item.type === "COUPON_DISCOUNT",
          );
          assert.ok(line);
          assert.match(line!.label, /حداکثر قابل اعمال/);
        }
        // Floor: taxable >= ceil(cost/(1-0.2))*term + parchin*term (+addons)
        const keep = 8_000n;
        const monthlyFloor = (cost * 10_000n + keep - 1n) / keep;
        const protectedFloor =
          monthlyFloor * BigInt(term) + 2_000_000n * BigInt(term);
        assert.ok(
          breakdown.taxableRial >= protectedFloor,
          `floor breach cost=${cost} term=${term} coupon=${coupon}`,
        );
      }
    }
  }
});

test("audit: card/quote/checkout monthly parity shape for 1-month purchase", () => {
  for (const cost of [
    2_000_000n * TOMAN_TO_RIAL,
    5_500_000n * TOMAN_TO_RIAL,
    11_000_000n * TOMAN_TO_RIAL,
    16_000_000n * TOMAN_TO_RIAL,
    30_000_000n * TOMAN_TO_RIAL,
  ]) {
    const resolved = resolveProviderMarkupForPlan({
      plan: { offerSource: "API_CATALOG", productKind: "READY_INSTANT_SERVER" },
      providerMonthlyCostRial: cost,
      providerConfigMarkupBps: 4_286,
      profitCurve: defaultProfitCurveConfig(),
    });
    const card = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: cost,
      providerMarkupBps: resolved.providerMarkupBps,
      productMarkupBps: 0,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 500_000n,
      taxBps: 1_000,
      termMonths: 1,
      infrastructureSaleRialOverride: resolved.infrastructureSaleRialOverride,
      minimumPostDiscountGrossMarginBps: 2_000,
    });
    const quote = computeCommercialPriceBreakdown({
      providerMonthlyPriceIrr: cost,
      providerMarkupBps: resolved.providerMarkupBps,
      productMarkupBps: 0,
      parchinLevel: "PARCHIN_START",
      parchinPriceIrr: 500_000n,
      taxBps: 1_000,
      termMonths: 1,
      infrastructureSaleRialOverride: resolved.infrastructureSaleRialOverride,
      minimumPostDiscountGrossMarginBps: 2_000,
    });
    assert.equal(card.finalPriceRial, quote.finalPriceRial);
  }
});

test("audit: CSV formula injection neutralized", () => {
  assert.equal(csvEscape("=CMD()"), "'=CMD()");
  assert.equal(csvEscape("+1234"), "'+1234");
  assert.equal(csvEscape("-SUM(A1)"), "'-SUM(A1)");
  assert.equal(csvEscape("@macro"), "'@macro");
  assert.equal(csvEscape("normal"), "normal");
  assert.equal(csvEscape('say "hi", please'), '"say ""hi"", please"');
});

test("audit: recognized revenue fractions cover day1 / mid / end / after", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  for (const term of [1, 3, 6, 12]) {
    const day1 = recognitionFraction({
      occurredAt: start,
      termMonths: term,
      asOf: new Date(start.getTime() + 24 * 60 * 60 * 1000),
    });
    assert.ok(day1.recognizedNumerator > 0n);
    assert.ok(day1.recognizedNumerator < day1.recognizedDenominator);

    const mid = recognitionFraction({
      occurredAt: start,
      termMonths: term,
      asOf: new Date(
        start.getTime() + (term * 30 * 24 * 60 * 60 * 1000) / 2,
      ),
    });
    assert.ok(mid.recognizedNumerator > 0n);
    assert.ok(mid.recognizedNumerator < mid.recognizedDenominator);

    const end = recognitionFraction({
      occurredAt: start,
      termMonths: term,
      asOf: new Date(start.getTime() + term * 30 * 24 * 60 * 60 * 1000),
    });
    assert.equal(end.recognizedNumerator, end.recognizedDenominator);

    const after = recognitionFraction({
      occurredAt: start,
      termMonths: term,
      asOf: new Date(start.getTime() + (term + 2) * 30 * 24 * 60 * 60 * 1000),
    });
    assert.equal(after.recognizedNumerator, after.recognizedDenominator);
  }
});

test("audit: default band structure remains valid", () => {
  const issues = validateProfitCurveStructure(defaultProfitCurveConfig());
  assert.equal(issues.length, 0);
  assert.equal(bands[0]!.minProviderCostRial, 0n);
  assert.equal(bands[bands.length - 1]!.maxProviderCostRial, null);
});

test("audit: flat transition sale is intentional continuity characteristic", () => {
  const t0 = transitions[0]!;
  const sales = new Set<string>();
  for (
    let cost = t0.boundaryRial;
    cost < t0.transitionEndRial;
    cost += (t0.transitionEndRial - t0.boundaryRial) / 20n
  ) {
    const sale = resolveProfitCurve({
      providerMonthlyCostRial: cost,
      bands,
    }).infrastructureSaleRial;
    sales.add(sale.toString());
    assert.equal(sale, t0.boundarySaleRial);
  }
  // Many distinct costs share one sale — documented business characteristic.
  assert.equal(sales.size, 1);
});
