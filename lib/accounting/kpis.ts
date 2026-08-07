import {
  AccountingJournalStatus,
  AccountingQuality,
  type Prisma,
} from "@prisma/client";

import {
  ACCOUNT_DEFINITIONS,
  type AccountCode,
  isAccountCode,
} from "@/lib/accounting/accounts";
import { prisma } from "@/lib/db";

export type KpiView = "booked" | "recognized";

export type AccountingKpiTotals = {
  view: KpiView;
  grossBilledRial: bigint;
  taxRial: bigint;
  netSalesExclTaxRial: bigint;
  providerCogsRial: bigint;
  grossProfitRial: bigint;
  operatingExpenseRial: bigint;
  operatingProfitRial: bigint;
  /** Gross profit / net sales, in basis points. Null when net sales is zero. */
  effectiveMarginBps: number | null;
  /**
   * True when totals include only FINAL/ESTIMATED qualities (exact GP safe).
   * False when caller explicitly included NEEDS_RECONCILIATION.
   */
  grossProfitExact: boolean;
};

export type KpiQuery = {
  from?: Date;
  to?: Date;
  view?: KpiView;
  /** As-of date for recognition schedule (defaults to `to` or now). */
  asOf?: Date;
  qualities?: AccountingQuality[];
};

const REVENUE_CODES: AccountCode[] = [
  "INFRASTRUCTURE_REVENUE",
  "PARCHIN_REVENUE",
  "ADDON_REVENUE",
];
const CONTRA_CODES: AccountCode[] = [
  "TERM_DISCOUNT",
  "COUPON_DISCOUNT",
  "SALES_REFUND",
];
const COGS_CODES: AccountCode[] = [
  "PROVIDER_INFRASTRUCTURE_COGS",
  "PROVIDER_ADDON_COGS",
];
const OPEX_CODES: AccountCode[] = [
  "GATEWAY_FEES",
  "SMS_EXPENSE",
  "SUPPORT_OPERATIONS",
  "HOSTING_OPERATIONS",
  "MARKETING_EXPENSE",
  "PAYROLL_CONTRACTOR",
  "OTHER_OPERATING_EXPENSE",
];

function netCredit(debit: bigint, credit: bigint): bigint {
  return credit - debit;
}

function netDebit(debit: bigint, credit: bigint): bigint {
  return debit - credit;
}

function readTermMonths(metadata: Prisma.JsonValue | null | undefined): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 1;
  }
  const value = (metadata as Record<string, unknown>).termMonths;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed > 0 ? parsed : 1;
  }
  return 1;
}

/**
 * Straight-line recognition fraction for a prepaid term.
 * Tax is excluded from recognition math by callers (tax stays as payable).
 */
export function recognitionFraction(input: {
  occurredAt: Date;
  termMonths: number;
  asOf: Date;
  periodFrom?: Date;
  periodTo?: Date;
}): { recognizedNumerator: bigint; recognizedDenominator: bigint } {
  const termMonths = Math.max(1, input.termMonths);
  const start = input.occurredAt.getTime();
  const termEnd = start + termMonths * 30 * 24 * 60 * 60 * 1000;
  const asOf = input.asOf.getTime();
  const windowStart = input.periodFrom?.getTime() ?? start;
  const windowEnd = input.periodTo?.getTime() ?? asOf;

  const recognizedThrough = Math.min(asOf, termEnd);
  const overlapStart = Math.max(start, windowStart);
  const overlapEnd = Math.min(recognizedThrough, windowEnd);
  if (overlapEnd <= overlapStart || termEnd <= start) {
    return { recognizedNumerator: 0n, recognizedDenominator: 1n };
  }

  const totalMs = BigInt(termEnd - start);
  const overlapMs = BigInt(overlapEnd - overlapStart);
  return {
    recognizedNumerator: overlapMs,
    recognizedDenominator: totalMs > 0n ? totalMs : 1n,
  };
}

function applyFraction(
  amount: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (amount === 0n || numerator === 0n) return 0n;
  // Round half-up in integer rial space.
  return (amount * numerator + denominator / 2n) / denominator;
}

function marginBps(grossProfit: bigint, netSales: bigint): number | null {
  if (netSales === 0n) return null;
  const sign = netSales < 0n ? -1n : 1n;
  const absNet = netSales < 0n ? -netSales : netSales;
  const raw = (grossProfit * 10_000n * sign + absNet / 2n) / absNet;
  return Number(raw);
}

/**
 * Exact KPI definitions:
 * - grossBilled = infrastructure + parchin + addon revenue credits (net of revenue debits)
 * - tax = TAX_PAYABLE net credits (excluded from net sales and recognition)
 * - netSalesExclTax = grossBilled − contra revenue (discounts + sales refunds)
 * - providerCogs = infrastructure + addon COGS net debits
 * - grossProfit = netSalesExclTax − providerCogs
 * - operatingProfit = grossProfit − opex
 * - effectiveMarginBps = grossProfit / netSalesExclTax
 *
 * Booked: full amounts on journal occurredAt within range (POSTED + not reversed quality).
 * Recognized: straight-line over termMonths for prepaid revenue/COGS; tax excluded.
 */
export async function computeAccountingKpis(
  query: KpiQuery = {},
): Promise<AccountingKpiTotals> {
  const view = query.view ?? "booked";
  const asOf = query.asOf ?? query.to ?? new Date();
  const qualities =
    query.qualities ??
    [
      AccountingQuality.FINAL,
      AccountingQuality.ESTIMATED,
    ];

  const entries = await prisma.accountingJournalEntry.findMany({
    where: {
      status: {
        in: [AccountingJournalStatus.POSTED, AccountingJournalStatus.REVERSED],
      },
      quality: { in: qualities },
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    },
    include: { lines: true },
    orderBy: { occurredAt: "asc" },
  });

  let grossBilled = 0n;
  let tax = 0n;
  let contra = 0n;
  let cogs = 0n;
  let opex = 0n;
  const includesNeedsReconciliation = qualities.includes(
    AccountingQuality.NEEDS_RECONCILIATION,
  );

  for (const entry of entries) {
    // Reversed originals are excluded from booked/recognized moving totals;
    // their reversing entries (status POSTED) carry the offsetting amounts.
    if (entry.status === AccountingJournalStatus.REVERSED) continue;
    if (entry.quality === AccountingQuality.REVERSED) continue;

    const termMonths = readTermMonths(entry.metadata);
    const fraction =
      view === "recognized"
        ? recognitionFraction({
            occurredAt: entry.occurredAt,
            termMonths,
            asOf,
            periodFrom: query.from,
            periodTo: query.to,
          })
        : { recognizedNumerator: 1n, recognizedDenominator: 1n };

    // Booked view filters by occurredAt in the query; recognized uses overlap.
    if (view === "booked") {
      // already filtered by occurredAt
    } else if (
      fraction.recognizedNumerator === 0n &&
      (query.from || query.to)
    ) {
      // Still allow tax? Tax is excluded from recognition entirely.
    }

    for (const line of entry.lines) {
      if (!isAccountCode(line.accountCode)) continue;
      const code = line.accountCode;
      const def = ACCOUNT_DEFINITIONS[code];
      const bookedNetCredit = netCredit(line.debitRial, line.creditRial);
      const bookedNetDebit = netDebit(line.debitRial, line.creditRial);

      if (REVENUE_CODES.includes(code)) {
        const amount =
          view === "booked"
            ? bookedNetCredit
            : applyFraction(
                bookedNetCredit,
                fraction.recognizedNumerator,
                fraction.recognizedDenominator,
              );
        grossBilled += amount;
        continue;
      }
      if (CONTRA_CODES.includes(code)) {
        const amount =
          view === "booked"
            ? bookedNetDebit
            : applyFraction(
                bookedNetDebit,
                fraction.recognizedNumerator,
                fraction.recognizedDenominator,
              );
        contra += amount;
        continue;
      }
      if (code === "TAX_PAYABLE") {
        // Tax is never part of recognized revenue; booked tax is reported separately.
        if (view === "booked") {
          tax += bookedNetCredit;
        }
        continue;
      }
      if (COGS_CODES.includes(code)) {
        const amount =
          view === "booked"
            ? bookedNetDebit
            : applyFraction(
                bookedNetDebit,
                fraction.recognizedNumerator,
                fraction.recognizedDenominator,
              );
        cogs += amount;
        continue;
      }
      if (OPEX_CODES.includes(code) || def.accountClass === "opex") {
        // Operating expenses recognized when posted (no prepaid term).
        if (view === "booked" || view === "recognized") {
          opex += bookedNetDebit;
        }
      }
    }
  }

  const netSales = grossBilled - contra;
  const grossProfit = netSales - cogs;
  const operatingProfit = grossProfit - opex;

  return {
    view,
    grossBilledRial: grossBilled,
    taxRial: tax,
    netSalesExclTaxRial: netSales,
    providerCogsRial: cogs,
    grossProfitRial: grossProfit,
    operatingExpenseRial: opex,
    operatingProfitRial: operatingProfit,
    effectiveMarginBps: marginBps(grossProfit, netSales),
    // Incomplete cost snapshots must not be presented as exact profit.
    grossProfitExact: !includesNeedsReconciliation,
  };
}
