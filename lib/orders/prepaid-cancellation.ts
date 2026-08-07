/**
 * Prepaid cancellation refund math.
 *
 * Uses the same straight-line recognition fraction already authoritative for
 * AbrChin prepaid accounting KPIs. Does not invent a separate commercial
 * formula. PAYG usage settlement is out of scope and must not use this helper.
 */

import { recognitionFraction } from "@/lib/accounting/kpis";

export type PrepaidCancellationPreview = {
  billingModel: "PREPAID_TERM";
  originalPaidRial: bigint;
  serviceStartedAt: string;
  asOf: string;
  termMonths: number;
  consumedRial: bigint;
  nonRefundableRial: bigint;
  refundableRial: bigint;
  /** Wallet available balance before credit. */
  walletBalanceRial: bigint;
  walletBalanceAfterRefundRial: bigint;
};

function applyFraction(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (amount <= 0n || numerator <= 0n) return 0n;
  // Match accounting KPI half-up integer rial math.
  return (amount * numerator + denominator / 2n) / denominator;
}

/**
 * Compute unused prepaid value for a term purchase.
 * Non-refundable amount is only applied when the caller supplies a policy-defined
 * value; the product contract currently defines none (defaults to 0).
 */
export function computePrepaidCancellationPreview(input: {
  originalPaidRial: bigint;
  termMonths: number;
  serviceStartedAt: Date;
  asOf?: Date;
  nonRefundableRial?: bigint;
  walletBalanceRial: bigint;
}): PrepaidCancellationPreview {
  if (input.originalPaidRial < 0n) {
    throw new Error("invalid_original_paid");
  }
  const asOf = input.asOf ?? new Date();
  const nonRefundable =
    input.nonRefundableRial && input.nonRefundableRial > 0n
      ? input.nonRefundableRial
      : 0n;
  if (nonRefundable > input.originalPaidRial) {
    throw new Error("invalid_non_refundable");
  }

  const { recognizedNumerator, recognizedDenominator } = recognitionFraction({
    occurredAt: input.serviceStartedAt,
    termMonths: input.termMonths,
    asOf,
  });

  const refundableBase = input.originalPaidRial - nonRefundable;
  const consumed = applyFraction(
    refundableBase,
    recognizedNumerator,
    recognizedDenominator,
  );
  const refundable =
    refundableBase > consumed ? refundableBase - consumed : 0n;

  return {
    billingModel: "PREPAID_TERM",
    originalPaidRial: input.originalPaidRial,
    serviceStartedAt: input.serviceStartedAt.toISOString(),
    asOf: asOf.toISOString(),
    termMonths: Math.max(1, input.termMonths),
    consumedRial: consumed,
    nonRefundableRial: nonRefundable,
    refundableRial: refundable,
    walletBalanceRial: input.walletBalanceRial,
    walletBalanceAfterRefundRial: input.walletBalanceRial + refundable,
  };
}

export function serializePrepaidCancellationPreview(
  preview: PrepaidCancellationPreview,
) {
  return {
    billingModel: preview.billingModel,
    originalPaidRial: preview.originalPaidRial.toString(),
    serviceStartedAt: preview.serviceStartedAt,
    asOf: preview.asOf,
    termMonths: preview.termMonths,
    consumedRial: preview.consumedRial.toString(),
    nonRefundableRial: preview.nonRefundableRial.toString(),
    refundableRial: preview.refundableRial.toString(),
    walletBalanceRial: preview.walletBalanceRial.toString(),
    walletBalanceAfterRefundRial:
      preview.walletBalanceAfterRefundRial.toString(),
  };
}
