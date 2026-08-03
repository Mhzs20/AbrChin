import assert from "node:assert/strict";
import test from "node:test";

import {
  BillingPolicyError,
  assertCadenceAllowed,
  buildPriceDisplay,
  calculateMarkupRial,
  calculateMinimumCreditRial,
  latestClosedPeriodUtc,
  periodContainingUtc,
  validateBillingPolicyContract,
} from "../lib/billing/policy.ts";
import {
  billingDefaultsForNewPlan,
  parsePlanBillingPolicyInput,
} from "../lib/billing/policy-admin.ts";

const basePolicy = {
  availability: "HOURLY_ONLY" as const,
  defaultCadence: "HOURLY" as const,
  displayMode: "BOTH" as const,
  hourlyMinimumCreditHours: 12,
  dailyMinimumCreditDays: 2,
  hourlyGracePeriods: 6,
  dailyGracePeriods: 2,
  lowBalanceThresholdPeriods: 3,
};

test("HOURLY_ONLY accepts hourly and rejects daily", () => {
  assert.doesNotThrow(() => assertCadenceAllowed("HOURLY_ONLY", "HOURLY"));
  assert.throws(
    () => assertCadenceAllowed("HOURLY_ONLY", "DAILY"),
    (error) =>
      error instanceof BillingPolicyError &&
      error.code === "billing_cadence_disabled",
  );
});

test("DAILY_ONLY accepts daily and rejects hourly", () => {
  assert.doesNotThrow(() => assertCadenceAllowed("DAILY_ONLY", "DAILY"));
  assert.throws(
    () => assertCadenceAllowed("DAILY_ONLY", "HOURLY"),
    BillingPolicyError,
  );
});

test("HOURLY_AND_DAILY permits exactly one selected cadence at activation", () => {
  assert.doesNotThrow(() =>
    assertCadenceAllowed("HOURLY_AND_DAILY", "HOURLY"),
  );
  assert.doesNotThrow(() =>
    assertCadenceAllowed("HOURLY_AND_DAILY", "DAILY"),
  );
});

test("minimum credit follows selected settlement cadence without Float", () => {
  const hourly = calculateMinimumCreditRial({
    policy: basePolicy,
    cadence: "HOURLY",
    hourlyEstimateRial: 1_250n,
    dailyEstimateRial: 30_000n,
    oneTimeChargesRial: 5_000n,
  });
  assert.equal(hourly, 20_000n);

  const daily = calculateMinimumCreditRial({
    policy: {
      ...basePolicy,
      availability: "DAILY_ONLY",
      defaultCadence: "DAILY",
    },
    cadence: "DAILY",
    hourlyEstimateRial: 1_250n,
    dailyEstimateRial: 28_000n,
    oneTimeChargesRial: 5_000n,
  });
  assert.equal(daily, 61_000n);
});

test("display BOTH does not imply two financial cadences", () => {
  const display = buildPriceDisplay({
    displayMode: "BOTH",
    hourlyRateRial: 2_000n,
    independentDailyRateRial: null,
  });
  assert.deepEqual(display, {
    hourly: 2_000n,
    daily: 48_000n,
    dailyIsEstimate: true,
    independentDailyRateAvailable: false,
  });
});

test("independent daily provider rate remains distinct from hourly x 24", () => {
  const display = buildPriceDisplay({
    displayMode: "BOTH",
    hourlyRateRial: 2_000n,
    independentDailyRateRial: 42_000n,
  });
  assert.equal(display.daily, 42_000n);
  assert.equal(display.dailyIsEstimate, false);
});

test("UTC hourly and daily period boundaries are deterministic", () => {
  const instant = new Date("2026-08-03T12:34:56.789Z");
  assert.deepEqual(periodContainingUtc("HOURLY", instant), {
    periodStart: new Date("2026-08-03T12:00:00.000Z"),
    periodEnd: new Date("2026-08-03T13:00:00.000Z"),
  });
  assert.deepEqual(latestClosedPeriodUtc("DAILY", instant), {
    periodStart: new Date("2026-08-02T00:00:00.000Z"),
    periodEnd: new Date("2026-08-03T00:00:00.000Z"),
  });
});

test("percentage markup rounds upward in integer rial", () => {
  assert.equal(calculateMarkupRial(10_001n, 1_500), 1_501n);
  assert.equal(calculateMarkupRial(10_000n, 0), 0n);
});

test("policy validation rejects hidden invalid buffer values", () => {
  assert.throws(
    () =>
      validateBillingPolicyContract({
        ...basePolicy,
        hourlyMinimumCreditHours: 0,
      }),
    BillingPolicyError,
  );
});

test("new Cloud plans are PAYG hourly by global policy while ready servers stay prepaid", () => {
  assert.deepEqual(
    billingDefaultsForNewPlan("CLOUD_SERVER", "global-hourly-v1"),
    {
      billingModel: "PAYG_WALLET",
      billingPolicyVersionId: "global-hourly-v1",
    },
  );
  assert.deepEqual(
    billingDefaultsForNewPlan("READY_INSTANT_SERVER", null),
    {
      billingModel: "PREPAID_TERM",
      billingPolicyVersionId: null,
    },
  );
  assert.throws(
    () => billingDefaultsForNewPlan("CLOUD_SERVER", null),
    /Global Billing Policy/,
  );
});

test("Admin billing policy input is non-retroactive and supports zero grace", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const parsed = parsePlanBillingPolicyInput(
    {
      availability: "HOURLY_AND_DAILY",
      defaultCadence: "DAILY",
      displayMode: "BOTH",
      hourlyMinimumCreditHours: 12,
      dailyMinimumCreditDays: 1,
      hourlyGracePeriods: 0,
      dailyGracePeriods: 2,
      lowBalanceThresholdPeriods: 3,
      effectiveFrom: "2026-08-03T13:00:00.000Z",
      changeReason: "controlled policy update",
    },
    now,
  );
  assert.equal(parsed.hourlyGracePeriods, 0);
  assert.throws(
    () =>
      parsePlanBillingPolicyInput(
        {
          ...parsed,
          effectiveFrom: "2026-08-03T11:59:00.000Z",
        },
        now,
      ),
    /نمی‌تواند در گذشته/,
  );
});
