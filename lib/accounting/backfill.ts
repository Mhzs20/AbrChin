import {
  OperatingExpenseStatus,
  RenewalQuoteStatus,
  ServiceOrderStatus,
  TopUpStatus,
} from "@prisma/client";

import {
  postManualExpensePosted,
  postServicePurchaseCompleted,
  postServiceRefundCompleted,
  postServiceRenewalCompleted,
  postWalletTopUpRefunded,
  postWalletTopUpSucceeded,
} from "@/lib/accounting/posting";
import { prisma } from "@/lib/db";

export type AccountingBackfillCounts = {
  dryRun: boolean;
  walletTopUps: number;
  walletTopUpRefunds: number;
  servicePurchases: number;
  serviceRefunds: number;
  renewals: number;
  expenses: number;
  errors: Array<{ kind: string; id: string; message: string }>;
};

export type AccountingBackfillOptions = {
  dryRun?: boolean;
};

/**
 * Idempotent historical backfill. Uses the same posting helpers as live hooks.
 * Never invents provider cost from the current catalog — snapshots only.
 */
export async function runAccountingBackfill(
  options: AccountingBackfillOptions = {},
): Promise<AccountingBackfillCounts> {
  const dryRun = options.dryRun === true;
  const counts: AccountingBackfillCounts = {
    dryRun,
    walletTopUps: 0,
    walletTopUpRefunds: 0,
    servicePurchases: 0,
    serviceRefunds: 0,
    renewals: 0,
    expenses: 0,
    errors: [],
  };

  const topUps = await prisma.walletTopUp.findMany({
    where: { status: TopUpStatus.SUCCEEDED },
    orderBy: { createdAt: "asc" },
  });
  for (const topUp of topUps) {
    try {
      if (!dryRun) await postWalletTopUpSucceeded(topUp);
      counts.walletTopUps += 1;
    } catch (error) {
      counts.errors.push({
        kind: "wallet_topup",
        id: topUp.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const topUpRefunds = await prisma.walletTopUpRefund.findMany({
    where: { status: { in: ["APPROVED", "COMPLETED"] } },
    orderBy: { requestedAt: "asc" },
  });
  for (const refund of topUpRefunds) {
    try {
      if (!dryRun) {
        await postWalletTopUpRefunded({
          id: refund.id,
          walletTopUpId: refund.walletTopUpId,
          amount: refund.amount,
          occurredAt:
            refund.completedAt ?? refund.reviewedAt ?? refund.requestedAt,
        });
      }
      counts.walletTopUpRefunds += 1;
    } catch (error) {
      counts.errors.push({
        kind: "wallet_topup_refund",
        id: refund.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const paidOrders = await prisma.serviceOrder.findMany({
    where: { status: ServiceOrderStatus.PAID },
    include: { recommendationQuote: true },
    orderBy: { paidAt: "asc" },
  });
  for (const order of paidOrders) {
    try {
      if (!dryRun) await postServicePurchaseCompleted(order);
      counts.servicePurchases += 1;
    } catch (error) {
      counts.errors.push({
        kind: "service_purchase",
        id: order.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const refundedOrders = await prisma.serviceOrder.findMany({
    where: { status: ServiceOrderStatus.REFUNDED },
    include: { recommendationQuote: true },
    orderBy: { updatedAt: "asc" },
  });
  for (const order of refundedOrders) {
    try {
      if (!dryRun) {
        await postServiceRefundCompleted(order);
      }
      counts.serviceRefunds += 1;
    } catch (error) {
      counts.errors.push({
        kind: "service_refund",
        id: order.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const renewals = await prisma.serviceRenewalQuote.findMany({
    where: { status: RenewalQuoteStatus.PAID },
    orderBy: { paidAt: "asc" },
  });
  for (const quote of renewals) {
    try {
      if (!dryRun) await postServiceRenewalCompleted(quote);
      counts.renewals += 1;
    } catch (error) {
      counts.errors.push({
        kind: "renewal",
        id: quote.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const expenses = await prisma.operatingExpense.findMany({
    where: { status: OperatingExpenseStatus.POSTED },
    orderBy: { postedAt: "asc" },
  });
  for (const expense of expenses) {
    try {
      if (!dryRun) {
        await postManualExpensePosted({
          id: expense.id,
          amountRial: expense.amountRial,
          category: expense.category,
          title: expense.title,
          date: expense.date,
        });
      }
      counts.expenses += 1;
    } catch (error) {
      counts.errors.push({
        kind: "operating_expense",
        id: expense.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return counts;
}
