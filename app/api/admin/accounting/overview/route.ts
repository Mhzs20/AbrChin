import {
  AccountingQuality,
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  ServiceOrderStatus,
} from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  computeAccountingKpis,
  type KpiView,
} from "@/lib/accounting/kpis";
import {
  buildAccountingOverview,
  type AccountingReportFilters,
} from "@/lib/accounting/reports";
import { accountingJsonOk } from "@/lib/accounting/serialize";
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

function previousPeriod(from?: Date, to?: Date): { from?: Date; to?: Date } {
  if (!from || !to) return {};
  const span = to.getTime() - from.getTime();
  if (span <= 0) return {};
  return {
    from: new Date(from.getTime() - span),
    to: new Date(from.getTime() - 1),
  };
}

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const url = new URL(request.url);
    const filters = parseFilters(url);
    const prev = previousPeriod(filters.from, filters.to);

    const [overview, previousKpis] = await Promise.all([
      buildAccountingOverview(filters),
      prev.from && prev.to
        ? computeAccountingKpis({
            from: prev.from,
            to: prev.to,
            view: filters.view ?? "booked",
            qualities: filters.dataQuality ? [filters.dataQuality] : undefined,
          })
        : Promise.resolve(null),
    ]);

    return accountingJsonOk({
      overview,
      previousKpis,
      filters: {
        from: filters.from?.toISOString() ?? null,
        to: filters.to?.toISOString() ?? null,
        view: filters.view ?? "booked",
      },
      disclaimer:
        "این گزارش سود و زیان عملیاتی/مدیریتی است و دفتر قانونی حسابداری ایران نیست.",
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error(
      "[admin/accounting/overview]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("خواندن خلاصه حسابداری ممکن نیست.", 500);
  }
}
