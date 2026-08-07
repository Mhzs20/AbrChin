import {
  AccountingJournalStatus,
  AccountingQuality,
  ServiceOrderStatus,
  type InfrastructureProductKind,
  type InfrastructureProvider,
  type Prisma,
} from "@prisma/client";

import { isAccountCode, type AccountCode } from "@/lib/accounting/accounts";
import {
  computeAccountingKpis,
  type AccountingKpiTotals,
  type KpiView,
} from "@/lib/accounting/kpis";
import { prisma } from "@/lib/db";
import { rialToToman } from "@/lib/money";

export type AccountingReportFilters = {
  from?: Date;
  to?: Date;
  provider?: InfrastructureProvider | null;
  productKind?: InfrastructureProductKind | null;
  location?: string | null;
  parchin?: boolean | null;
  /** Exact Parchin level (also used for NO/OSTOVAR/KAHKESHAN chinish mapping). */
  parchinLevel?: string | null;
  orderStatus?: ServiceOrderStatus | null;
  dataQuality?: AccountingQuality | null;
  view?: KpiView;
};

export type OrderProfitabilityRow = {
  orderId: string;
  paidAt: string | null;
  status: ServiceOrderStatus;
  provider: InfrastructureProvider | null;
  productKind: InfrastructureProductKind | null;
  regionCode: string | null;
  parchinLevel: string | null;
  termMonths: number;
  grossBilledRial: bigint;
  taxRial: bigint;
  netSalesExclTaxRial: bigint;
  providerCogsRial: bigint;
  /** Null when provider cost is missing — never show invented exact profit. */
  grossProfitRial: bigint | null;
  effectiveMarginBps: number | null;
  quality: AccountingQuality | null;
  missingProviderCost: boolean;
};

export type AccountingOverview = {
  kpis: AccountingKpiTotals;
  orderCount: number;
  needsReconciliationCount: number;
  /** Sum of net sales for orders needing reconciliation / missing cost. */
  needsReconciliationAmountRial: bigint;
  ordersMissingCostSnapshot: number;
  /** 0–10000 bps of orders with usable FINAL/ESTIMATED cost data. */
  dataCompletenessBps: number;
  rows: OrderProfitabilityRow[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseRegion(planSnapshot: Prisma.JsonValue | null | undefined): string | null {
  const plan = asRecord(planSnapshot ?? null);
  return typeof plan?.regionCode === "string" ? plan.regionCode : null;
}

function netCredit(debit: bigint, credit: bigint) {
  return credit - debit;
}

function netDebit(debit: bigint, credit: bigint) {
  return debit - credit;
}

function marginBps(grossProfit: bigint, netSales: bigint): number | null {
  if (netSales === 0n) return null;
  const absNet = netSales < 0n ? -netSales : netSales;
  const sign = netSales < 0n ? -1n : 1n;
  return Number((grossProfit * 10_000n * sign + absNet / 2n) / absNet);
}

const REVENUE: AccountCode[] = [
  "INFRASTRUCTURE_REVENUE",
  "PARCHIN_REVENUE",
  "ADDON_REVENUE",
];
const CONTRA: AccountCode[] = [
  "TERM_DISCOUNT",
  "COUPON_DISCOUNT",
  "SALES_REFUND",
];
const COGS: AccountCode[] = [
  "PROVIDER_INFRASTRUCTURE_COGS",
  "PROVIDER_ADDON_COGS",
];

export async function buildOrderProfitabilityRows(
  filters: AccountingReportFilters = {},
): Promise<OrderProfitabilityRow[]> {
  const orders = await prisma.serviceOrder.findMany({
    where: {
      status: filters.orderStatus
        ? filters.orderStatus
        : { in: [ServiceOrderStatus.PAID, ServiceOrderStatus.REFUNDED] },
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.productKind ? { productKind: filters.productKind } : {}),
      ...(filters.parchinLevel
        ? { parchinLevel: filters.parchinLevel as never }
        : filters.parchin === true
          ? { parchinLevel: { not: null } }
          : filters.parchin === false
            ? { parchinLevel: null }
            : {}),
      ...(filters.from || filters.to
        ? {
            paidAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { paidAt: "desc" },
  });

  const orderIds = orders.map((order) => order.id);
  const journals =
    orderIds.length === 0
      ? []
      : await prisma.accountingJournalEntry.findMany({
          where: {
            referenceType: "service_order",
            referenceId: { in: orderIds },
            status: AccountingJournalStatus.POSTED,
            eventType: {
              in: [
                "service_purchase_completed",
                "service_refund_completed",
                "service_purchase_completed:reversal",
              ],
            },
            ...(filters.dataQuality ? { quality: filters.dataQuality } : {}),
          },
          include: { lines: true },
        });

  const byOrder = new Map<string, typeof journals>();
  for (const entry of journals) {
    const list = byOrder.get(entry.referenceId) ?? [];
    list.push(entry);
    byOrder.set(entry.referenceId, list);
  }

  const rows: OrderProfitabilityRow[] = [];
  for (const order of orders) {
    const regionCode = parseRegion(order.planSnapshot);
    if (
      filters.location &&
      regionCode &&
      regionCode.toLowerCase() !== filters.location.toLowerCase()
    ) {
      continue;
    }
    if (filters.location && !regionCode) continue;

    const entries = byOrder.get(order.id) ?? [];
    if (filters.dataQuality && entries.length === 0) continue;

    let grossBilled = 0n;
    let tax = 0n;
    let contra = 0n;
    let cogs = 0n;
    let quality: AccountingQuality | null = null;
    let missingProviderCost = false;
    let termMonths = order.termMonths || 1;

    for (const entry of entries) {
      quality = entry.quality;
      const meta = asRecord(entry.metadata);
      if (meta?.providerCostPresent === false) missingProviderCost = true;
      if (typeof meta?.termMonths === "number" && meta.termMonths > 0) {
        termMonths = meta.termMonths;
      }
      for (const line of entry.lines) {
        if (!isAccountCode(line.accountCode)) continue;
        const code = line.accountCode;
        if (REVENUE.includes(code)) {
          grossBilled += netCredit(line.debitRial, line.creditRial);
        } else if (CONTRA.includes(code)) {
          contra += netDebit(line.debitRial, line.creditRial);
        } else if (code === "TAX_PAYABLE") {
          tax += netCredit(line.debitRial, line.creditRial);
        } else if (COGS.includes(code)) {
          cogs += netDebit(line.debitRial, line.creditRial);
        }
      }
    }

    const netSales = grossBilled - contra;
    const incomplete =
      missingProviderCost ||
      quality === AccountingQuality.NEEDS_RECONCILIATION;
    const grossProfit = incomplete ? null : netSales - cogs;
    rows.push({
      orderId: order.id,
      paidAt: order.paidAt?.toISOString() ?? null,
      status: order.status,
      provider: order.provider,
      productKind: order.productKind,
      regionCode,
      parchinLevel: order.parchinLevel,
      termMonths,
      grossBilledRial: grossBilled,
      taxRial: tax,
      netSalesExclTaxRial: netSales,
      providerCogsRial: cogs,
      grossProfitRial: grossProfit,
      effectiveMarginBps:
        grossProfit == null ? null : marginBps(grossProfit, netSales),
      quality,
      missingProviderCost,
    });
  }

  return rows;
}

export async function buildAccountingOverview(
  filters: AccountingReportFilters = {},
): Promise<AccountingOverview> {
  const [kpis, rows] = await Promise.all([
    computeAccountingKpis({
      from: filters.from,
      to: filters.to,
      view: filters.view ?? "booked",
      // Default KPI totals stay FINAL-only so incomplete cost snapshots cannot
      // invent exact gross profit. Callers may still filter explicitly.
      qualities: filters.dataQuality
        ? [filters.dataQuality]
        : [AccountingQuality.FINAL, AccountingQuality.ESTIMATED],
    }),
    buildOrderProfitabilityRows(filters),
  ]);

  const needsRows = rows.filter(
    (row) =>
      row.quality === AccountingQuality.NEEDS_RECONCILIATION ||
      row.missingProviderCost,
  );
  const missingCostRows = rows.filter((row) => row.missingProviderCost);
  const completeCount = rows.length - needsRows.length;
  const dataCompletenessBps =
    rows.length === 0
      ? 10_000
      : Math.round((completeCount * 10_000) / rows.length);

  return {
    kpis,
    orderCount: rows.length,
    needsReconciliationCount: needsRows.length,
    needsReconciliationAmountRial: needsRows.reduce(
      (sum, row) => sum + row.netSalesExclTaxRial,
      0n,
    ),
    ordersMissingCostSnapshot: missingCostRows.length,
    dataCompletenessBps,
    rows,
  };
}

/**
 * Escape CSV cells for Excel/LibreOffice safety:
 * - quote commas/quotes/newlines
 * - neutralize formula injection for leading = + - @ TAB CR
 */
export function csvEscape(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

export function orderProfitabilityToCsv(rows: OrderProfitabilityRow[]): string {
  const header = [
    "orderId",
    "paidAt",
    "status",
    "provider",
    "productKind",
    "regionCode",
    "parchinLevel",
    "termMonths",
    "grossBilledRial",
    "grossBilledToman",
    "taxRial",
    "taxToman",
    "netSalesExclTaxRial",
    "netSalesExclTaxToman",
    "providerCogsRial",
    "providerCogsToman",
    "grossProfitRial",
    "grossProfitToman",
    "effectiveMarginBps",
    "quality",
    "missingProviderCost",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.orderId,
        row.paidAt ?? "",
        row.status,
        row.provider ?? "",
        row.productKind ?? "",
        row.regionCode ?? "",
        row.parchinLevel ?? "",
        String(row.termMonths),
        row.grossBilledRial.toString(),
        rialToToman(row.grossBilledRial).toString(),
        row.taxRial.toString(),
        rialToToman(row.taxRial).toString(),
        row.netSalesExclTaxRial.toString(),
        rialToToman(row.netSalesExclTaxRial).toString(),
        row.providerCogsRial.toString(),
        rialToToman(row.providerCogsRial).toString(),
        row.grossProfitRial == null ? "" : row.grossProfitRial.toString(),
        row.grossProfitRial == null
          ? ""
          : rialToToman(row.grossProfitRial).toString(),
        row.effectiveMarginBps?.toString() ?? "",
        row.quality ?? "",
        row.missingProviderCost ? "true" : "false",
      ]
        .map((cell) => csvEscape(cell))
        .join(","),
    );
  }
  // UTF-8 BOM for Excel-friendly Persian CSV.
  return `\uFEFF${lines.join("\n")}\n`;
}

export function kpisToCsv(kpis: AccountingKpiTotals): string {
  const rows: Array<[string, string, string]> = [
    ["view", kpis.view, ""],
    [
      "grossBilled",
      kpis.grossBilledRial.toString(),
      rialToToman(kpis.grossBilledRial).toString(),
    ],
    ["tax", kpis.taxRial.toString(), rialToToman(kpis.taxRial).toString()],
    [
      "netSalesExclTax",
      kpis.netSalesExclTaxRial.toString(),
      rialToToman(kpis.netSalesExclTaxRial).toString(),
    ],
    [
      "providerCogs",
      kpis.providerCogsRial.toString(),
      rialToToman(kpis.providerCogsRial).toString(),
    ],
    [
      "grossProfit",
      kpis.grossProfitRial.toString(),
      rialToToman(kpis.grossProfitRial).toString(),
    ],
    [
      "operatingExpense",
      kpis.operatingExpenseRial.toString(),
      rialToToman(kpis.operatingExpenseRial).toString(),
    ],
    [
      "operatingProfit",
      kpis.operatingProfitRial.toString(),
      rialToToman(kpis.operatingProfitRial).toString(),
    ],
    [
      "effectiveMarginBps",
      kpis.effectiveMarginBps?.toString() ?? "",
      "",
    ],
  ];
  const header = "metric,rial,toman";
  return `\uFEFF${[header, ...rows.map((r) => r.join(","))].join("\n")}\n`;
}
