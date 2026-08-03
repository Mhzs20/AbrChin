import type {
  BillingAvailability,
  BillingCadence,
  BillingPriceDisplayMode,
} from "@prisma/client";

export class BillingPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BillingPolicyError";
    this.code = code;
  }
}

export type BillingPolicyContract = {
  availability: BillingAvailability;
  defaultCadence: BillingCadence;
  displayMode: BillingPriceDisplayMode;
  hourlyMinimumCreditHours: number;
  dailyMinimumCreditDays: number;
  hourlyGracePeriods: number;
  dailyGracePeriods: number;
  lowBalanceThresholdPeriods: number;
};

export function isCadenceAllowed(
  availability: BillingAvailability,
  cadence: BillingCadence,
) {
  if (availability === "HOURLY_AND_DAILY") return true;
  if (availability === "HOURLY_ONLY") return cadence === "HOURLY";
  return cadence === "DAILY";
}

export function assertCadenceAllowed(
  availability: BillingAvailability,
  cadence: BillingCadence,
) {
  if (!isCadenceAllowed(availability, cadence)) {
    throw new BillingPolicyError(
      "billing_cadence_disabled",
      "دورهٔ تسویهٔ انتخاب‌شده برای این پلن فعال نیست.",
    );
  }
}

export function validateBillingPolicyContract(policy: BillingPolicyContract) {
  assertCadenceAllowed(policy.availability, policy.defaultCadence);
  for (const value of [
    policy.hourlyMinimumCreditHours,
    policy.dailyMinimumCreditDays,
    policy.lowBalanceThresholdPeriods,
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BillingPolicyError(
        "invalid_billing_policy",
        "بازه‌های مالی باید عدد صحیح مثبت باشند.",
      );
    }
  }
  for (const value of [policy.hourlyGracePeriods, policy.dailyGracePeriods]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BillingPolicyError(
        "invalid_billing_policy",
        "مهلت مالی باید عدد صحیح نامنفی باشد.",
      );
    }
  }
  return policy;
}

export function calculateMarkupRial(
  normalizedProviderCostRial: bigint,
  markupBasisPoints: number,
) {
  if (
    normalizedProviderCostRial < 0n ||
    !Number.isSafeInteger(markupBasisPoints) ||
    markupBasisPoints < 0 ||
    markupBasisPoints > 100_000
  ) {
    throw new BillingPolicyError(
      "invalid_markup",
      "هزینه یا درصد سود معتبر نیست.",
    );
  }
  if (normalizedProviderCostRial === 0n || markupBasisPoints === 0) return 0n;
  return (
    normalizedProviderCostRial * BigInt(markupBasisPoints) +
    9_999n
  ) / 10_000n;
}

export function calculateMinimumCreditRial(input: {
  policy: BillingPolicyContract;
  cadence: BillingCadence;
  hourlyEstimateRial: bigint | null;
  dailyEstimateRial: bigint | null;
  oneTimeChargesRial: bigint;
}) {
  assertCadenceAllowed(input.policy.availability, input.cadence);
  if (input.oneTimeChargesRial < 0n) {
    throw new BillingPolicyError(
      "invalid_one_time_charge",
      "هزینهٔ یک‌باره معتبر نیست.",
    );
  }
  if (input.cadence === "HOURLY") {
    if (input.hourlyEstimateRial == null || input.hourlyEstimateRial < 0n) {
      throw new BillingPolicyError(
        "hourly_estimate_unavailable",
        "تخمین ساعتی معتبر برای این پلن موجود نیست.",
      );
    }
    return (
      input.hourlyEstimateRial *
        BigInt(input.policy.hourlyMinimumCreditHours) +
      input.oneTimeChargesRial
    );
  }
  if (input.dailyEstimateRial == null || input.dailyEstimateRial < 0n) {
    throw new BillingPolicyError(
      "daily_estimate_unavailable",
      "تخمین روزانهٔ معتبر برای این پلن موجود نیست.",
    );
  }
  return (
    input.dailyEstimateRial * BigInt(input.policy.dailyMinimumCreditDays) +
    input.oneTimeChargesRial
  );
}

export function calculateResourceChangeBufferRial(input: {
  policy: BillingPolicyContract;
  cadence: BillingCadence;
  currentHourlyEstimateRial: bigint;
  targetHourlyEstimateRial: bigint;
  currentDailyEstimateRial: bigint;
  targetDailyEstimateRial: bigint;
  oneTimeChargesRial?: bigint;
}) {
  validateBillingPolicyContract(input.policy);
  assertCadenceAllowed(input.policy.availability, input.cadence);
  const oneTimeCharges = input.oneTimeChargesRial ?? 0n;
  if (oneTimeCharges < 0n) {
    throw new BillingPolicyError(
      "invalid_one_time_charge",
      "One-time charge cannot be negative",
    );
  }
  const current =
    input.cadence === "HOURLY"
      ? input.currentHourlyEstimateRial
      : input.currentDailyEstimateRial;
  const target =
    input.cadence === "HOURLY"
      ? input.targetHourlyEstimateRial
      : input.targetDailyEstimateRial;
  const incrementalRate = target > current ? target - current : 0n;
  const periods =
    input.cadence === "HOURLY"
      ? BigInt(input.policy.hourlyMinimumCreditHours)
      : BigInt(input.policy.dailyMinimumCreditDays);
  return incrementalRate * periods + oneTimeCharges;
}

export function evaluateResourceChangeCredit(input: {
  availableBalanceRial: bigint;
  requiredIncrementalBufferRial: bigint;
  isDowngrade: boolean;
}) {
  if (
    input.availableBalanceRial < 0n ||
    input.requiredIncrementalBufferRial < 0n
  ) {
    throw new BillingPolicyError(
      "invalid_credit_evaluation",
      "Credit evaluation amounts cannot be negative",
    );
  }
  if (input.isDowngrade) {
    return {
      allowed: true as const,
      shortfallRial: 0n,
    };
  }
  const shortfall =
    input.requiredIncrementalBufferRial > input.availableBalanceRial
      ? input.requiredIncrementalBufferRial - input.availableBalanceRial
      : 0n;
  return {
    allowed: shortfall === 0n,
    shortfallRial: shortfall,
  };
}

export function buildPriceDisplay(input: {
  displayMode: BillingPriceDisplayMode;
  hourlyRateRial: bigint | null;
  independentDailyRateRial: bigint | null;
}) {
  const equivalent24HourEstimateRial =
    input.hourlyRateRial == null ? null : input.hourlyRateRial * 24n;
  const dailyDisplayRial =
    input.independentDailyRateRial ?? equivalent24HourEstimateRial;
  return {
    hourly:
      input.displayMode === "DAILY" ? null : input.hourlyRateRial,
    daily:
      input.displayMode === "HOURLY" ? null : dailyDisplayRial,
    dailyIsEstimate: input.independentDailyRateRial == null,
    independentDailyRateAvailable:
      input.independentDailyRateRial != null,
  };
}

export function periodContainingUtc(
  cadence: BillingCadence,
  instant: Date,
) {
  const timestamp = instant.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new BillingPolicyError("invalid_time", "زمان Billing معتبر نیست.");
  }
  const start = new Date(timestamp);
  if (cadence === "HOURLY") {
    start.setUTCMinutes(0, 0, 0);
  } else {
    start.setUTCHours(0, 0, 0, 0);
  }
  const durationMs =
    cadence === "HOURLY" ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  return {
    periodStart: start,
    periodEnd: new Date(start.getTime() + durationMs),
  };
}

export function latestClosedPeriodUtc(
  cadence: BillingCadence,
  now: Date,
) {
  const current = periodContainingUtc(cadence, now);
  const durationMs =
    cadence === "HOURLY" ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  return {
    periodStart: new Date(current.periodStart.getTime() - durationMs),
    periodEnd: current.periodStart,
  };
}

export function calculateRunwaySeconds(
  availableBalanceRial: bigint,
  hourlyBurnRial: bigint,
) {
  if (availableBalanceRial < 0n || hourlyBurnRial < 0n) {
    throw new BillingPolicyError(
      "invalid_runway_input",
      "موجودی یا نرخ مصرف معتبر نیست.",
    );
  }
  if (hourlyBurnRial === 0n) return null;
  return (availableBalanceRial * 3_600n) / hourlyBurnRial;
}
