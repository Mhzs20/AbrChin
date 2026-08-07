import {
  AccountingQuality,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  ServiceOrderStatus,
} from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import type { KpiView } from "@/lib/accounting/kpis";
import {
  buildAccountingOverview,
  buildOrderProfitabilityRows,
  kpisToCsv,
  orderProfitabilityToCsv,
  type AccountingReportFilters,
} from "@/lib/accounting/reports";
import { jsonError } from "@/lib/http";
import { storefrontParchinForTier } from "@/lib/storefront/presentation";
import { isStorefrontTier } from "@/lib/storefront/tiers";

export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseFilters(url: URL): AccountingReportFilters {
  const provider = url.searchParams.get("provider");
  const productKind = url.searchParams.get("productKind");
  const orderStatus = url.searchParams.get("orderStatus");
  const dataQuality = url.searchParams.get("dataQuality");
  const parchin = url.searchParams.get("parchin");
  const parchinLevel = url.searchParams.get("parchinLevel");
  const chinishTier = url.searchParams.get("chinishTier");
  const viewRaw = url.searchParams.get("view");
  const view: KpiView =
    viewRaw === "recognized" ? "recognized" : "booked";
  const mappedParchin =
    chinishTier && isStorefrontTier(chinishTier)
      ? storefrontParchinForTier(chinishTier)
      : null;

  return {
    from: parseDate(url.searchParams.get("from")),
    to: parseDate(url.searchParams.get("to")),
    provider:
      provider &&
      Object.values(InfrastructureProvider).includes(
        provider as InfrastructureProvider,
      )
        ? (provider as InfrastructureProvider)
        : null,
    productKind:
      productKind &&
      Object.values(InfrastructureProductKind).includes(
        productKind as InfrastructureProductKind,
      )
        ? (productKind as InfrastructureProductKind)
        : null,
    location: url.searchParams.get("location"),
    parchin: parchin === "true" ? true : parchin === "false" ? false : null,
    parchinLevel:
      mappedParchin ??
      (parchinLevel &&
      Object.values(ParchinLevel).includes(parchinLevel as ParchinLevel)
        ? parchinLevel
        : null),
    orderStatus:
      orderStatus &&
      Object.values(ServiceOrderStatus).includes(
        orderStatus as ServiceOrderStatus,
      )
        ? (orderStatus as ServiceOrderStatus)
        : null,
    dataQuality:
      dataQuality &&
      Object.values(AccountingQuality).includes(
        dataQuality as AccountingQuality,
      )
        ? (dataQuality as AccountingQuality)
        : null,
    view,
  };
}

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const filters = parseFilters(url);
    const kind = url.searchParams.get("kind") ?? "orders";

    let csv: string;
    let filename: string;
    if (kind === "kpis") {
      const overview = await buildAccountingOverview(filters);
      csv = kpisToCsv(overview.kpis);
      filename = "abrchin-accounting-kpis.csv";
    } else {
      const rows = await buildOrderProfitabilityRows(filters);
      csv = orderProfitabilityToCsv(rows);
      filename = "abrchin-accounting-orders.csv";
    }

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/accounting/export]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("خروجی CSV حسابداری ممکن نیست.", 500);
  }
}
