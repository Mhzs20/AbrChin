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
