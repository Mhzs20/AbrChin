import type { Metadata } from "next";
import Link from "next/link";

import { FinanceCenterPanel } from "@/components/admin/finance-center-panel";
import { PageHeader } from "@/components/product";
import { readFinanceConfiguration } from "@/lib/admin/finance-configuration";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "مرکز مالی | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminFinanceCenterPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [configuration, coupons] = await Promise.all([
    readFinanceConfiguration(),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <>
      <PageHeader
        title="مرکز مالی"
        description="حاشیه سود هدف را تعیین کن؛ موتور واحد قیمت‌گذاری همان عدد را روی کارت، Quote و تمدید اعمال می‌کند. هر انتشار نسخه‌دار و قابل بازگشت است."
        actions={
          <>
            <Link
              href="/admin/wallets"
              className="product-btn product-btn--quiet"
            >
              کیف پول‌ها
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

      <FinanceCenterPanel
        initialConfiguration={configuration}
        initialCoupons={coupons.map((coupon) => ({
          id: coupon.id,
          code: coupon.code,
          type: coupon.type,
          scope: coupon.scope,
          discountBps: coupon.discountBps,
          termMonths: coupon.termMonths,
          minDepositRial: coupon.minDepositRial?.toString() ?? null,
          bonusRial: coupon.bonusRial?.toString() ?? null,
          expiresAt: coupon.expiresAt?.toISOString() ?? null,
          maxRedemptions: coupon.maxRedemptions,
          redemptionCount: coupon.redemptionCount,
          active: coupon.active,
        }))}
      />
    </>
  );
}
