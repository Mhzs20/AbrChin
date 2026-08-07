import {
  AccountingQuality,
  type Prisma,
  type ServiceOrder,
  type ServiceRenewalQuote,
  type WalletTopUp,
} from "@prisma/client";

import type { AccountCode } from "@/lib/accounting/accounts";
import {
  postJournalEntry,
  reverseJournalEntry,
  type JournalLineInput,
} from "@/lib/accounting/journal";

type Db = Prisma.TransactionClient;

type JsonRecord = Record<string, unknown>;

type SnapshotLine = {
  type: string;
  amountIrr: bigint;
  label?: string;
};

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function parseBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}

function parseSnapshotLines(raw: unknown): SnapshotLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: SnapshotLine[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.type !== "string") continue;
    const amount = parseBigInt(row.amountIrr);
    if (amount === null) continue;
    lines.push({
      type: row.type,
      amountIrr: amount,
      label: typeof row.label === "string" ? row.label : undefined,
    });
  }
  return lines;
}

function sumByType(lines: SnapshotLine[], type: string): bigint {
  return lines
    .filter((line) => line.type === type)
    .reduce((sum, line) => sum + line.amountIrr, 0n);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function pushLine(
  lines: JournalLineInput[],
  accountCode: AccountCode,
  debitRial: bigint,
  creditRial: bigint,
  description?: string,
) {
  if (debitRial === 0n && creditRial === 0n) return;
  lines.push({ accountCode, debitRial, creditRial, description });
}

function resolveOrderSnapshots(order: {
  planSnapshot?: Prisma.JsonValue | null;
  recommendationQuote?: {
    lineItemsSnapshot?: Prisma.JsonValue | null;
    providerBasePriceRialSnapshot?: bigint | null;
    providerMonthlyPriceIrr?: bigint | null;
    taxAmountIrr?: bigint | null;
    parchinPriceIrr?: bigint | null;
    termMonths?: number | null;
  } | null;
  termMonths?: number | null;
  amount?: bigint;
}) {
  const plan = asRecord(order.planSnapshot ?? null);
  const quoteLines = parseSnapshotLines(
    order.recommendationQuote?.lineItemsSnapshot,
  );
  const planLines = parseSnapshotLines(plan?.lineItemsSnapshot);
  const lines = quoteLines.length > 0 ? quoteLines : planLines;

  const providerFromLines = sumByType(lines, "PROVIDER_INFRASTRUCTURE");
  const markupFromLines = sumByType(lines, "INFRASTRUCTURE_MARKUP");
  const parchinFromLines = sumByType(lines, "PARCHIN");
  const addonFromLines = sumByType(lines, "PROVIDER_ADDON");
  const termDiscountFromLines = abs(sumByType(lines, "TERM_DISCOUNT"));
  const couponDiscountFromLines = abs(sumByType(lines, "COUPON_DISCOUNT"));
  const taxFromLines = sumByType(lines, "TAX");

  const providerMonthly =
    parseBigInt(plan?.providerBasePriceRialSnapshot) ??
    parseBigInt(plan?.estimatedProviderCostRial) ??
    order.recommendationQuote?.providerBasePriceRialSnapshot ??
    order.recommendationQuote?.providerMonthlyPriceIrr ??
    null;

  const markupMonthly = parseBigInt(plan?.markupAmountRialSnapshot);

  const termMonths =
    order.termMonths ??
    order.recommendationQuote?.termMonths ??
    (typeof plan?.termMonths === "number" ? plan.termMonths : 1);
  const safeTermMonths = termMonths && termMonths > 0 ? termMonths : 1;
  const termMultiplier = BigInt(safeTermMonths);

  const providerFromSnapshot =
    providerFromLines > 0n
      ? providerFromLines
      : providerMonthly !== null
        ? providerMonthly * termMultiplier
        : null;

  const markupFromSnapshot =
    markupFromLines > 0n
      ? markupFromLines
      : markupMonthly !== null
        ? markupMonthly * termMultiplier
        : null;

  const infrastructureRevenue =
    (providerFromSnapshot ?? 0n) + (markupFromSnapshot ?? 0n) > 0n
      ? (providerFromSnapshot ?? 0n) + (markupFromSnapshot ?? 0n)
      : providerFromLines + markupFromLines;

  const parchinMonthly =
    parseBigInt(plan?.parchinPriceRialSnapshot) ??
    order.recommendationQuote?.parchinPriceIrr ??
    null;
  const parchinRevenue =
    parchinFromLines > 0n
      ? parchinFromLines
      : parchinMonthly !== null
        ? parchinMonthly * termMultiplier
        : 0n;

  const taxPayable =
    taxFromLines > 0n
      ? taxFromLines
      : parseBigInt(plan?.taxAmountRialSnapshot) ??
        order.recommendationQuote?.taxAmountIrr ??
        0n;

  const hasProviderCost =
    providerFromSnapshot !== null && providerFromSnapshot > 0n;

  return {
    lines,
    infrastructureRevenue:
      infrastructureRevenue > 0n
        ? infrastructureRevenue
        : providerFromLines + markupFromLines,
    parchinRevenue: parchinRevenue > 0n ? parchinRevenue : 0n,
    addonRevenue: addonFromLines > 0n ? addonFromLines : 0n,
    termDiscount: termDiscountFromLines,
    couponDiscount: couponDiscountFromLines,
    taxPayable: taxPayable > 0n ? taxPayable : 0n,
    providerInfrastructureCogs: hasProviderCost ? providerFromSnapshot : null,
    providerAddonCogs: addonFromLines > 0n ? addonFromLines : null,
    hasProviderCost,
    termMonths: safeTermMonths,
  };
}

function buildPurchaseLines(input: {
  walletAmount: bigint;
  infrastructureRevenue: bigint;
  parchinRevenue: bigint;
  addonRevenue: bigint;
  termDiscount: bigint;
  couponDiscount: bigint;
  taxPayable: bigint;
  providerInfrastructureCogs: bigint | null;
  providerAddonCogs: bigint | null;
  includeCogs: boolean;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  pushLine(
    lines,
    "CUSTOMER_WALLET_LIABILITY",
    input.walletAmount,
    0n,
    "آزادسازی بدهی کیف پول بابت خرید سرویس",
  );
  pushLine(
    lines,
    "INFRASTRUCTURE_REVENUE",
    0n,
    input.infrastructureRevenue,
    "درآمد زیرساخت",
  );
  pushLine(lines, "PARCHIN_REVENUE", 0n, input.parchinRevenue, "درآمد پرچین");
  pushLine(lines, "ADDON_REVENUE", 0n, input.addonRevenue, "درآمد افزونه");
  pushLine(lines, "TERM_DISCOUNT", input.termDiscount, 0n, "تخفیف دوره");
  pushLine(lines, "COUPON_DISCOUNT", input.couponDiscount, 0n, "تخفیف کد");
  pushLine(lines, "TAX_PAYABLE", 0n, input.taxPayable, "مالیات پرداختنی");

  if (input.includeCogs) {
    if (input.providerInfrastructureCogs && input.providerInfrastructureCogs > 0n) {
      pushLine(
        lines,
        "PROVIDER_INFRASTRUCTURE_COGS",
        input.providerInfrastructureCogs,
        0n,
        "بهای تمام‌شده زیرساخت (Snapshot)",
      );
      pushLine(
        lines,
        "PROVIDER_FUNDING_CLEARING",
        0n,
        input.providerInfrastructureCogs,
        "تسویه تأمین زیرساخت",
      );
    }
    if (input.providerAddonCogs && input.providerAddonCogs > 0n) {
      pushLine(
        lines,
        "PROVIDER_ADDON_COGS",
        input.providerAddonCogs,
        0n,
        "بهای تمام‌شده افزونه (Snapshot)",
      );
      pushLine(
        lines,
        "PROVIDER_FUNDING_CLEARING",
        0n,
        input.providerAddonCogs,
        "تسویه تأمین افزونه",
      );
    }
  }

  return lines;
}

/**
 * Wallet top-up is NOT revenue. Cash at gateway increases; wallet liability increases.
 */
export async function postWalletTopUpSucceeded(
  topUp: Pick<WalletTopUp, "id" | "amount" | "verifiedAt" | "createdAt">,
  tx?: Db,
) {
  return postJournalEntry({
    eventType: "wallet_topup_succeeded",
    referenceType: "wallet_topup",
    referenceId: topUp.id,
    idempotencyKey: `wallet-topup:${topUp.id}:succeeded:v1`,
    occurredAt: topUp.verifiedAt ?? topUp.createdAt,
    quality: AccountingQuality.FINAL,
    metadata: { amountRial: topUp.amount.toString() },
    lines: [
      {
        accountCode: "CASH_GATEWAY",
        debitRial: topUp.amount,
        creditRial: 0n,
        description: "دریافت وجه درگاه",
      },
      {
        accountCode: "CUSTOMER_WALLET_LIABILITY",
        debitRial: 0n,
        creditRial: topUp.amount,
        description: "بدهی کیف پول مشتری",
      },
    ],
    tx,
  });
}

export async function postWalletTopUpRefunded(
  input: {
    id: string;
    amount: bigint;
    walletTopUpId: string;
    occurredAt?: Date | null;
  },
  tx?: Db,
) {
  const topUpId = input.walletTopUpId;
  const refundId = input.id;
  const occurredAt = input.occurredAt ?? new Date();
  return postJournalEntry({
    eventType: "wallet_topup_refunded",
    referenceType: "wallet_topup_refund",
    referenceId: refundId,
    idempotencyKey: `wallet-topup:${topUpId}:refunded:v1`,
    occurredAt,
    quality: AccountingQuality.FINAL,
    metadata: {
      topUpId,
      amountRial: input.amount.toString(),
    },
    lines: [
      {
        accountCode: "CUSTOMER_WALLET_LIABILITY",
        debitRial: input.amount,
        creditRial: 0n,
        description: "کاهش بدهی کیف پول بابت بازپرداخت شارژ",
      },
      {
        accountCode: "CASH_GATEWAY",
        debitRial: 0n,
        creditRial: input.amount,
        description: "خروج وجه درگاه بابت بازپرداخت شارژ",
      },
    ],
    tx,
  });
}

export async function postServicePurchaseCompleted(
  order: ServiceOrder & {
    recommendationQuote?: {
      lineItemsSnapshot?: Prisma.JsonValue | null;
      providerBasePriceRialSnapshot?: bigint | null;
      providerMonthlyPriceIrr?: bigint | null;
      taxAmountIrr?: bigint | null;
      parchinPriceIrr?: bigint | null;
      termMonths?: number | null;
    } | null;
  },
  tx?: Db,
) {
  const snap = resolveOrderSnapshots(order);
  const includeCogs = snap.hasProviderCost;
  const quality = includeCogs
    ? AccountingQuality.FINAL
    : AccountingQuality.NEEDS_RECONCILIATION;

  // If snapshots do not balance to wallet debit, still post wallet release +
  // available components and mark NEEDS_RECONCILIATION rather than inventing.
  let infrastructureRevenue = snap.infrastructureRevenue;
  const parchinRevenue = snap.parchinRevenue;
  const addonRevenue = snap.addonRevenue;
  const termDiscount = snap.termDiscount;
  const couponDiscount = snap.couponDiscount;
  const taxPayable = snap.taxPayable;

  const impliedWallet =
    infrastructureRevenue +
    parchinRevenue +
    addonRevenue -
    termDiscount -
    couponDiscount +
    taxPayable;

  let effectiveQuality = quality;
  if (impliedWallet !== order.amount) {
    effectiveQuality = AccountingQuality.NEEDS_RECONCILIATION;
    // Prefer immutable tax/discount/addon/parchin pieces; residual to infra.
    const residual =
      order.amount -
      (parchinRevenue + addonRevenue - termDiscount - couponDiscount + taxPayable);
    if (residual >= 0n) {
      infrastructureRevenue = residual;
    } else {
      // Cannot invent; post wallet vs deferred catch-all for ops review.
      return postJournalEntry({
        eventType: "service_purchase_completed",
        referenceType: "service_order",
        referenceId: order.id,
        idempotencyKey: `service-order:${order.id}:purchase:v1`,
        occurredAt: order.paidAt ?? order.createdAt,
        quality: AccountingQuality.NEEDS_RECONCILIATION,
        metadata: {
          termMonths: snap.termMonths,
          amountRial: order.amount.toString(),
          reason: "snapshot_unbalanced",
          impliedWalletRial: impliedWallet.toString(),
        },
        lines: [
          {
            accountCode: "CUSTOMER_WALLET_LIABILITY",
            debitRial: order.amount,
            creditRial: 0n,
          },
          {
            accountCode: "DEFERRED_REVENUE",
            debitRial: 0n,
            creditRial: order.amount,
            description: "نیاز به تطبیق Snapshot",
          },
        ],
        tx,
      });
    }
  }

  const lines = buildPurchaseLines({
    walletAmount: order.amount,
    infrastructureRevenue,
    parchinRevenue,
    addonRevenue,
    termDiscount,
    couponDiscount,
    taxPayable,
    providerInfrastructureCogs: snap.providerInfrastructureCogs,
    providerAddonCogs: snap.providerAddonCogs,
    includeCogs,
  });

  return postJournalEntry({
    eventType: "service_purchase_completed",
    referenceType: "service_order",
    referenceId: order.id,
    idempotencyKey: `service-order:${order.id}:purchase:v1`,
    occurredAt: order.paidAt ?? order.createdAt,
    quality: effectiveQuality,
    metadata: {
      termMonths: snap.termMonths,
      amountRial: order.amount.toString(),
      providerCostPresent: includeCogs,
      provider: order.provider ?? null,
      productKind: order.productKind ?? null,
      parchinLevel: order.parchinLevel ?? null,
    },
    lines,
    tx,
  });
}

function monthsBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 1;
  const days = ms / (1000 * 60 * 60 * 24);
  const months = Math.max(1, Math.round(days / 30));
  return months;
}

function resolveRenewalSnapshots(quote: ServiceRenewalQuote) {
  const lines = parseSnapshotLines(quote.lineItemsSnapshot);
  const providerFromLines = sumByType(lines, "PROVIDER_INFRASTRUCTURE");
  const markupFromLines = sumByType(lines, "INFRASTRUCTURE_MARKUP");
  const parchinFromLines = sumByType(lines, "PARCHIN");
  const addonFromLines = sumByType(lines, "PROVIDER_ADDON");
  const termDiscountFromLines = abs(sumByType(lines, "TERM_DISCOUNT"));
  const couponDiscountFromLines = abs(sumByType(lines, "COUPON_DISCOUNT"));
  const taxFromLines = sumByType(lines, "TAX");

  const providerCost =
    providerFromLines > 0n
      ? providerFromLines
      : quote.providerBasePriceRialSnapshot > 0n
        ? quote.providerBasePriceRialSnapshot
        : null;

  const infrastructureRevenue =
    providerFromLines + markupFromLines > 0n
      ? providerFromLines + markupFromLines
      : quote.finalPriceRialSnapshot -
        (quote.taxAmountIrrSnapshot ?? 0n) -
        (quote.parchinPriceIrrSnapshot ?? 0n);

  return {
    infrastructureRevenue: infrastructureRevenue > 0n ? infrastructureRevenue : 0n,
    parchinRevenue:
      parchinFromLines > 0n
        ? parchinFromLines
        : quote.parchinPriceIrrSnapshot ?? 0n,
    addonRevenue: addonFromLines > 0n ? addonFromLines : 0n,
    termDiscount: termDiscountFromLines,
    couponDiscount: couponDiscountFromLines,
    taxPayable:
      taxFromLines > 0n ? taxFromLines : quote.taxAmountIrrSnapshot ?? 0n,
    providerInfrastructureCogs: providerCost,
    providerAddonCogs: addonFromLines > 0n ? addonFromLines : null,
    hasProviderCost: providerCost !== null && providerCost > 0n,
    termMonths: monthsBetween(quote.periodStartSnapshot, quote.periodEndSnapshot),
  };
}

export async function postServiceRenewalCompleted(
  renewalQuote: ServiceRenewalQuote,
  tx?: Db,
) {
  const snap = resolveRenewalSnapshots(renewalQuote);
  const includeCogs = snap.hasProviderCost;
  const quality = includeCogs
    ? AccountingQuality.FINAL
    : AccountingQuality.NEEDS_RECONCILIATION;

  let infrastructureRevenue = snap.infrastructureRevenue;
  const implied =
    infrastructureRevenue +
    snap.parchinRevenue +
    snap.addonRevenue -
    snap.termDiscount -
    snap.couponDiscount +
    snap.taxPayable;

  let effectiveQuality = quality;
  if (implied !== renewalQuote.finalPriceRialSnapshot) {
    effectiveQuality = AccountingQuality.NEEDS_RECONCILIATION;
    const residual =
      renewalQuote.finalPriceRialSnapshot -
      (snap.parchinRevenue +
        snap.addonRevenue -
        snap.termDiscount -
        snap.couponDiscount +
        snap.taxPayable);
    infrastructureRevenue = residual > 0n ? residual : 0n;
    if (residual < 0n) {
      return postJournalEntry({
        eventType: "service_renewal_completed",
        referenceType: "renewal_quote",
        referenceId: renewalQuote.id,
        idempotencyKey: `service-renewal:${renewalQuote.id}:paid:v1`,
        occurredAt: renewalQuote.paidAt ?? renewalQuote.createdAt,
        quality: AccountingQuality.NEEDS_RECONCILIATION,
        metadata: {
          termMonths: snap.termMonths,
          amountRial: renewalQuote.finalPriceRialSnapshot.toString(),
          reason: "snapshot_unbalanced",
        },
        lines: [
          {
            accountCode: "CUSTOMER_WALLET_LIABILITY",
            debitRial: renewalQuote.finalPriceRialSnapshot,
            creditRial: 0n,
          },
          {
            accountCode: "DEFERRED_REVENUE",
            debitRial: 0n,
            creditRial: renewalQuote.finalPriceRialSnapshot,
          },
        ],
        tx,
      });
    }
  }

  return postJournalEntry({
    eventType: "service_renewal_completed",
    referenceType: "renewal_quote",
    referenceId: renewalQuote.id,
    idempotencyKey: `service-renewal:${renewalQuote.id}:paid:v1`,
    occurredAt: renewalQuote.paidAt ?? renewalQuote.createdAt,
    quality: effectiveQuality,
    metadata: {
      termMonths: snap.termMonths,
      amountRial: renewalQuote.finalPriceRialSnapshot.toString(),
      providerCostPresent: includeCogs,
      subscriptionId: renewalQuote.subscriptionId,
    },
    lines: buildPurchaseLines({
      walletAmount: renewalQuote.finalPriceRialSnapshot,
      infrastructureRevenue,
      parchinRevenue: snap.parchinRevenue,
      addonRevenue: snap.addonRevenue,
      termDiscount: snap.termDiscount,
      couponDiscount: snap.couponDiscount,
      taxPayable: snap.taxPayable,
      providerInfrastructureCogs: snap.providerInfrastructureCogs,
      providerAddonCogs: snap.providerAddonCogs,
      includeCogs,
    }),
    tx,
  });
}

export async function postPrepaidCancellationRefund(
  input: {
    orderId: string;
    amountRial: bigint;
    ledgerEntryId: string;
    occurredAt: Date;
  },
  tx?: Db,
) {
  if (input.amountRial <= 0n) return null;
  return postJournalEntry({
    eventType: "prepaid_cancellation_refunded",
    referenceType: "service_order",
    referenceId: input.orderId,
    idempotencyKey: `refund:${input.orderId}:prepaid-cancel:v1`,
    occurredAt: input.occurredAt,
    quality: AccountingQuality.FINAL,
    metadata: {
      kind: "prepaid_cancellation",
      amountRial: input.amountRial.toString(),
      ledgerEntryId: input.ledgerEntryId,
    },
    lines: [
      {
        accountCode: "SALES_REFUND",
        debitRial: input.amountRial,
        creditRial: 0n,
        description: "بازگشت فروش لغو دوره پیش‌پرداخت",
      },
      {
        accountCode: "CUSTOMER_WALLET_LIABILITY",
        debitRial: 0n,
        creditRial: input.amountRial,
        description: "اعتبار کیف پول بابت لغو سرویس",
      },
    ],
    tx,
  });
}

export async function postServiceRefundCompleted(
  order: ServiceOrder & {
    recommendationQuote?: {
      lineItemsSnapshot?: Prisma.JsonValue | null;
      providerBasePriceRialSnapshot?: bigint | null;
      providerMonthlyPriceIrr?: bigint | null;
      taxAmountIrr?: bigint | null;
      parchinPriceIrr?: bigint | null;
      termMonths?: number | null;
    } | null;
  },
  tx?: Db,
) {
  // Ensure the original purchase journal exists so refunds are true reversals
  // (keeps live hooks and historical backfill idempotent on the same keys).
  await postServicePurchaseCompleted(order, tx);

  const purchaseKey = `service-order:${order.id}:purchase:v1`;
  const { prisma } = await import("@/lib/db");
  const db = tx ?? prisma;
  const purchase = await db.accountingJournalEntry.findUnique({
    where: { idempotencyKey: purchaseKey },
  });
  if (!purchase) {
    throw new Error(`purchase_journal_missing_after_post:${order.id}`);
  }
  return reverseJournalEntry({
    journalEntryId: purchase.id,
    idempotencyKey: `refund:${order.id}:completed:v1`,
    reason: "service_order_refunded",
    tx,
  });
}

export async function postManualExpensePosted(
  expense: {
    id: string;
    amountRial: bigint;
    category: AccountCode | string;
    title: string;
    date: Date;
  },
  tx?: Db,
) {
  return postJournalEntry({
    eventType: "manual_expense_posted",
    referenceType: "operating_expense",
    referenceId: expense.id,
    idempotencyKey: `manual-expense:${expense.id}:posted:v1`,
    occurredAt: expense.date,
    quality: AccountingQuality.FINAL,
    metadata: {
      category: expense.category,
      title: expense.title,
      amountRial: expense.amountRial.toString(),
    },
    lines: [
      {
        accountCode: expense.category,
        debitRial: expense.amountRial,
        creditRial: 0n,
        description: expense.title,
      },
      {
        accountCode: "CASH_GATEWAY",
        debitRial: 0n,
        creditRial: expense.amountRial,
        description: "پرداخت هزینه عملیاتی",
      },
    ],
    tx,
  });
}

export async function postManualExpenseReversed(
  expense: {
    id: string;
    journalEntryId?: string | null;
  },
  tx?: Db,
) {
  const key = `manual-expense:${expense.id}:reversed:v1`;
  if (expense.journalEntryId) {
    return reverseJournalEntry({
      journalEntryId: expense.journalEntryId,
      idempotencyKey: key,
      reason: "manual_expense_reversed",
      tx,
    });
  }
  const { prisma } = await import("@/lib/db");
  const db = tx ?? prisma;
  const posted = await db.accountingJournalEntry.findUnique({
    where: { idempotencyKey: `manual-expense:${expense.id}:posted:v1` },
  });
  if (!posted) {
    throw new Error(`manual_expense_journal_missing:${expense.id}`);
  }
  return reverseJournalEntry({
    journalEntryId: posted.id,
    idempotencyKey: key,
    reason: "manual_expense_reversed",
    tx,
  });
}
