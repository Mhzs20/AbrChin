import type { Metadata } from "next";
import Link from "next/link";

import { LegacyProvidersHashRedirect } from "@/components/admin/legacy-providers-hash-redirect";
import { ProviderPanel } from "@/components/admin/provider-panel";
import { PageHeader } from "@/components/product";
import {
  getProviderCatalogAdminView,
  getProviderSyncRunsAdminView,
  getSystemStatuses,
} from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "منابع AV و PP | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function startOfUtcDay(now = new Date()) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export default async function AdminProvidersPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const dayStart = startOfUtcDay();
  const [system, catalogItems, syncRuns, todaySyncAgg] = await Promise.all([
    getSystemStatuses(),
    getProviderCatalogAdminView(),
    getProviderSyncRunsAdminView(),
    prisma.providerCatalogSyncRun.groupBy({
      by: ["provider"],
      where: {
        startedAt: { gte: dayStart },
        status: { in: ["SUCCEEDED", "PARTIAL"] },
      },
      _sum: { planCount: true },
      _count: { _all: true },
    }),
  ]);

  const todayByProvider = Object.fromEntries(
    todaySyncAgg.map((row) => [
      row.provider,
      {
        syncRunsToday: row._count._all,
        plansSyncedToday: row._sum.planCount ?? 0,
      },
    ]),
  ) as Record<
    string,
    { syncRunsToday: number; plansSyncedToday: number } | undefined
  >;

  return (
    <>
      <LegacyProvidersHashRedirect />
      <PageHeader
        title="منابع AV و PP"
        description="فقط اتصال، Sync روزانه و Markup منبع. قیمت/پرچین/کوپن و مناطق فروش صفحه‌های جدا دارند."
        actions={
          <>
            <Link
              href="/admin/infrastructure/regions"
              className="product-btn product-btn--quiet"
            >
              مناطق فروش
            </Link>
            <Link
              href="/admin/infrastructure/pricing"
              className="product-btn product-btn--quiet"
            >
              قواعد قیمت و پرچین
            </Link>
            <Link
              href="/admin/infrastructure/plans"
              className="product-btn product-btn--primary"
            >
              SKUهای قابل‌فروش
            </Link>
          </>
        }
      />

      <ProviderPanel
        provider="ARVAN"
        providerCode="AV"
        title="AV — سرور ابری"
        initial={{
          ...system.arvan,
          status: system.arvan.status,
          configured: system.arvan.status !== "unconfigured",
        }}
        catalogItems={catalogItems}
        syncRuns={syncRuns}
        dailyStats={
          todayByProvider.ARVAN ?? { syncRunsToday: 0, plansSyncedToday: 0 }
        }
      />
      <ProviderPanel
        provider="PARSPACK"
        providerCode="PP"
        title="PP — سرور آماده"
        initial={{
          ...system.parspack,
          status: system.parspack.status,
          configured: system.parspack.status !== "unconfigured",
        }}
        catalogItems={catalogItems}
        syncRuns={syncRuns}
        dailyStats={
          todayByProvider.PARSPACK ?? { syncRunsToday: 0, plansSyncedToday: 0 }
        }
      />
    </>
  );
}
