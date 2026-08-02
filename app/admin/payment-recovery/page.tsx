import type { Metadata } from "next";

import { PaymentRecoveryPanel } from "@/components/admin/payment-recovery-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { listPaymentRecoveryQueue } from "@/lib/payments/recovery";

export const metadata: Metadata = {
  title: "بازیابی پرداخت Wallet | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function PaymentRecoveryPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const cases = await listPaymentRecoveryQueue();
  const ledgerByTopUpId = new Map(
    (
      await prisma.walletLedgerEntry.findMany({
        where: {
          idempotencyKey: {
            in: cases.map(
              (item) => `topup_credit_${item.walletTopUpId}`,
            ),
          },
        },
      })
    ).map((entry) => [entry.referenceId, entry]),
  );

  const initialCases = cases.map((item) => {
    const ledger = ledgerByTopUpId.get(item.walletTopUpId);
    return {
      id: item.id,
      attemptId: item.attemptId,
      topUpId: item.walletTopUpId,
      customer:
        item.walletTopUp.wallet.user.displayName ||
        item.walletTopUp.wallet.user.mobile,
      gateway: item.attempt.gateway,
      gatewayReference: item.attempt.gatewayReference,
      attemptStatus: item.attempt.status,
      topUpStatus: item.walletTopUp.status,
      reasonCode: item.reasonCode,
      safeMessage: item.safeMessage,
      expectedAmountRial: item.expectedAmount.toString(),
      observedAmountRial: item.observedAmount?.toString() ?? null,
      expectedCurrency: item.expectedCurrency,
      observedCurrency: item.observedCurrency,
      nextAttemptAt: item.nextAttemptAt?.toISOString() ?? null,
      ledger: ledger
        ? {
            id: ledger.id,
            status: ledger.status,
            amountRial: ledger.amount.toString(),
          }
        : null,
      attempts: item.walletTopUp.paymentAttempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        gateway: attempt.gateway,
        gatewayReference: attempt.gatewayReference,
        createdAt: attempt.createdAt.toISOString(),
      })),
      refunds: item.walletTopUp.controlledRefunds.map((refund) => ({
        id: refund.id,
        status: refund.status,
        amountRial: refund.amount.toString(),
        requestedAt: refund.requestedAt.toISOString(),
      })),
    };
  });

  return (
    <>
      <PageHeader
        title="بازیابی پرداخت Wallet"
        description="Verify، Credit Reconciliation و Refund کنترل‌شده بدون نمایش Secret"
      />
      <PaymentRecoveryPanel initialCases={initialCases} />
    </>
  );
}
