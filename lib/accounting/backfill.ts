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
  /** Total historical source rows examined. */
  recordsScanned: number;
  /** Rows that would create a new journal entry (idempotency key absent). */
  entriesToCreate: number;
  /** Rows whose idempotency key already exists (safe no-op on real run). */
  alreadyPosted: number;
  /** Purchases/renewals expected to post as NEEDS_RECONCILIATION (missing/unbalanced provider cost). */
  needsReconciliation: number;
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

async function journalExists(idempotencyKey: string): Promise<boolean> {
  const existing = await prisma.accountingJournalEntry.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  return existing != null;
}

function orderNeedsReconciliation(order: {
  planSnapshot?: unknown;
  recommendationQuote?: {
    providerBasePriceRialSnapshot?: bigint | null;
    providerMonthlyPriceIrr?: bigint | null;
    lineItemsSnapshot?: unknown;
  } | null;
}): boolean {
  const quoteCost =
    order.recommendationQuote?.providerBasePriceRialSnapshot ??
    order.recommendationQuote?.providerMonthlyPriceIrr ??
    null;
  if (quoteCost != null && quoteCost > 0n) return false;
  const plan =
    order.planSnapshot && typeof order.planSnapshot === "object"
      ? (order.planSnapshot as Record<string, unknown>)
      : null;
  const planCostRaw =
    plan?.providerBasePriceRialSnapshot ?? plan?.estimatedProviderCostRial;
  if (typeof planCostRaw === "string" || typeof planCostRaw === "number") {
    try {
      return BigInt(planCostRaw) <= 0n;
    } catch {
      return true;
    }
  }
  return true;
}

/**
 * Idempotent historical backfill. Uses the same posting helpers as live hooks.
 * Never invents provider cost from the current catalog — snapshots only.
 * Never runs automatically from app startup or DB migration.
 */
export async function runAccountingBackfill(
  options: AccountingBackfillOptions = {},
): Promise<AccountingBackfillCounts> {
  const dryRun = options.dryRun === true;
  const counts: AccountingBackfillCounts = {
    dryRun,
    recordsScanned: 0,
    entriesToCreate: 0,
    alreadyPosted: 0,
    needsReconciliation: 0,
    walletTopUps: 0,
    walletTopUpRefunds: 0,
    servicePurchases: 0,
    serviceRefunds: 0,
    renewals: 0,
    expenses: 0,
    errors: [],
  };

  const track = async (idempotencyKey: string) => {
    counts.recordsScanned += 1;
    if (await journalExists(idempotencyKey)) {
      counts.alreadyPosted += 1;
      return "exists" as const;
    }
    counts.entriesToCreate += 1;
    return "create" as const;
  };

  const topUps = await prisma.walletTopUp.findMany({
    where: { status: TopUpStatus.SUCCEEDED },
    orderBy: { createdAt: "asc" },
  });
  for (const topUp of topUps) {
    try {
      const state = await track(`wallet-topup:${topUp.id}:succeeded:v1`);
      if (!dryRun && state === "create") await postWalletTopUpSucceeded(topUp);
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
      const state = await track(
        `wallet-topup:${refund.walletTopUpId}:refunded:v1`,
      );
      if (!dryRun && state === "create") {
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
      const state = await track(`service-order:${order.id}:purchase:v1`);
      if (
        orderNeedsReconciliation({
          planSnapshot: order.planSnapshot,
          recommendationQuote: order.recommendationQuote,
        })
      ) {
        counts.needsReconciliation += 1;
      }
      if (!dryRun && state === "create") await postServicePurchaseCompleted(order);
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
      const state = await track(`refund:${order.id}:completed:v1`);
      if (!dryRun && state === "create") {
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
      const state = await track(`service-renewal:${quote.id}:paid:v1`);
      if (
        quote.providerBasePriceRialSnapshot == null ||
        quote.providerBasePriceRialSnapshot <= 0n
      ) {
        counts.needsReconciliation += 1;
      }
      if (!dryRun && state === "create") await postServiceRenewalCompleted(quote);
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
      const state = await track(`manual-expense:${expense.id}:posted:v1`);
      if (!dryRun && state === "create") {
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
