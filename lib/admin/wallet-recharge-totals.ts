/** Pure BigInt helpers for Admin wallet recharge summaries (no DB). */

export function computeWalletRechargeTotals(input: {
  topUpCreditRial: bigint;
  topUpRefundRial: bigint;
}) {
  const topUpCreditRial =
    input.topUpCreditRial < 0n ? 0n : input.topUpCreditRial;
  const topUpRefundRial =
    input.topUpRefundRial < 0n ? 0n : input.topUpRefundRial;
  return {
    topUpCreditRial,
    topUpRefundRial,
    /** Gross gateway credits minus completed top-up refunds. */
    netTopUpRial:
      topUpCreditRial > topUpRefundRial
        ? topUpCreditRial - topUpRefundRial
        : 0n,
  };
}
