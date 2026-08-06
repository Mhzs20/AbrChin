import type { Metadata } from "next";
import Link from "next/link";

import { FinanceCenterPanel } from "@/components/admin/finance-center-panel";
import { PageHeader } from "@/components/product";
import { getCommercePricingAdminView } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { formatBasisPointsPercent } from "@/lib/pricing/provider-pricing";

export const metadata: Metadata = {
  title: "مرکز مالی | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminFinanceCenterPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [pricing, coupons, providerConfigs] = await Promise.all([
    getCommercePricingAdminView(),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.providerPricingConfig.findMany({
      where: { provider: { in: ["ARVAN", "PARSPACK"] } },
    }),
  ]);

  const byProvider = new Map(
    providerConfigs.map((config) => [config.provider, config]),
  );

  const initialProviders = (["ARVAN", "PARSPACK"] as const).map((provider) => {
    const config = byProvider.get(provider);
    const markupBasisPoints = config?.markupBasisPoints ?? 23_333;
    return {
      provider,
      markupPercent: formatBasisPointsPercent(markupBasisPoints),
      enabled: config?.enabled ?? true,
    };
  });

  return (
    <>
      <PageHeader
        title="مرکز مالی"
        description="قواعد قیمت فروش را از یکجا تنظیم کن. هر تب یک کار دارد؛ شبیه‌ساز کنار صفحه مبلغ نهایی مشتری را نشان می‌دهد."
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
        initialCommerce={pricing}
        initialProviders={initialProviders}
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
