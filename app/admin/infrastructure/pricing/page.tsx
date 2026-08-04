import type { Metadata } from "next";
import Link from "next/link";

import { CommercePricingPanel } from "@/components/admin/commerce-pricing-panel";
import { CouponsPanel } from "@/components/admin/coupons-panel";
import { PageHeader } from "@/components/product";
import { getCommercePricingAdminView } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "قواعد قیمت | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPricingPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [pricing, coupons] = await Promise.all([
    getCommercePricingAdminView(),
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <>
      <PageHeader
        title="قواعد قیمت و تخفیف"
        description="مالیات، پرچین، Markup محصول، چرخه یادآوری و کدهای تخفیف — جدا از Sync کاتالوگ."
        actions={
          <>
            <Link
              href="/admin/infrastructure/providers"
              className="product-btn product-btn--quiet"
            >
              منابع AV / PP
            </Link>
            <Link
              href="/admin/infrastructure/storefront"
              className="product-btn product-btn--primary"
            >
              چینش فروشگاهی
            </Link>
          </>
        }
      />

      <CommercePricingPanel initial={pricing} />
      <CouponsPanel
        initial={coupons.map((coupon) => ({
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
