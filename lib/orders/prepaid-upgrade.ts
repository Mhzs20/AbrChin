/**
 * Prepaid mid-term upgrade charge.
 *
 * Uses the same straight-line recognition fraction already authoritative for
 * AbrChin prepaid accounting (cancel preview / KPI recognition).
 *
 * Charge = remaining value of the target full-term commercial price
 *        − unused remaining value of the original prepaid payment.
 *
 * Does not invent a naive full-price subtraction.
 */

import { recognitionFraction } from "@/lib/accounting/kpis";

export type PrepaidUpgradeChargePreview = {
  billingModel: "PREPAID_TERM";
  originalPaidRial: bigint;
  newFullTermPriceRial: bigint;
  termMonths: number;
  serviceStartedAt: string;
  asOf: string;
  recognizedNumerator: string;
  recognizedDenominator: string;
  unusedCurrentRial: bigint;
  remainingTargetRial: bigint;
  upgradeChargeRial: bigint;
};

function applyFraction(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (amount <= 0n || numerator <= 0n) return 0n;
  return (amount * numerator + denominator / 2n) / denominator;
}

/**
 * Remaining (unrecognized) fraction of a prepaid term, as numerator/denominator
 * compatible with recognitionFraction.
 */
export function remainingRecognitionFraction(input: {
  occurredAt: Date;
  termMonths: number;
  asOf: Date;
}): { remainingNumerator: bigint; remainingDenominator: bigint } {
  const { recognizedNumerator, recognizedDenominator } = recognitionFraction({
    occurredAt: input.occurredAt,
    termMonths: input.termMonths,
    asOf: input.asOf,
  });
  const remaining =
    recognizedDenominator > recognizedNumerator
      ? recognizedDenominator - recognizedNumerator
      : 0n;
  return {
    remainingNumerator: remaining,
    remainingDenominator: recognizedDenominator,
  };
}

export function computePrepaidUpgradeCharge(input: {
  originalPaidRial: bigint;
  newFullTermPriceRial: bigint;
  termMonths: number;
  serviceStartedAt: Date;
  asOf?: Date;
}): PrepaidUpgradeChargePreview {
  if (input.originalPaidRial < 0n) {
    throw new Error("invalid_original_paid");
  }
  if (input.newFullTermPriceRial < 0n) {
    throw new Error("invalid_new_price");
  }
  const asOf = input.asOf ?? new Date();
  const termMonths = Math.max(1, input.termMonths);
  const { recognizedNumerator, recognizedDenominator } = recognitionFraction({
    occurredAt: input.serviceStartedAt,
    termMonths,
    asOf,
  });
  const { remainingNumerator, remainingDenominator } =
    remainingRecognitionFraction({
      occurredAt: input.serviceStartedAt,
      termMonths,
      asOf,
    });

  const unusedCurrentRial = applyFraction(
    input.originalPaidRial,
    remainingNumerator,
    remainingDenominator,
  );
  const remainingTargetRial = applyFraction(
    input.newFullTermPriceRial,
    remainingNumerator,
    remainingDenominator,
  );
  const upgradeChargeRial =
    remainingTargetRial > unusedCurrentRial
      ? remainingTargetRial - unusedCurrentRial
      : 0n;

  return {
    billingModel: "PREPAID_TERM",
    originalPaidRial: input.originalPaidRial,
    newFullTermPriceRial: input.newFullTermPriceRial,
    termMonths,
    serviceStartedAt: input.serviceStartedAt.toISOString(),
    asOf: asOf.toISOString(),
    recognizedNumerator: recognizedNumerator.toString(),
    recognizedDenominator: recognizedDenominator.toString(),
    unusedCurrentRial,
    remainingTargetRial,
    upgradeChargeRial,
  };
}

export function serializePrepaidUpgradeCharge(
  preview: PrepaidUpgradeChargePreview,
) {
  return {
    billingModel: preview.billingModel,
    originalPaidRial: preview.originalPaidRial.toString(),
    newFullTermPriceRial: preview.newFullTermPriceRial.toString(),
    termMonths: preview.termMonths,
    serviceStartedAt: preview.serviceStartedAt,
    asOf: preview.asOf,
    recognizedNumerator: preview.recognizedNumerator,
    recognizedDenominator: preview.recognizedDenominator,
    unusedCurrentRial: preview.unusedCurrentRial.toString(),
    remainingTargetRial: preview.remainingTargetRial.toString(),
    upgradeChargeRial: preview.upgradeChargeRial.toString(),
  };
}
