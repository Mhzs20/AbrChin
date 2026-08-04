import type { Metadata } from "next";

import { StorefrontAssortmentPanel } from "@/components/admin/storefront-assortment-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import {
  getStorefrontAssortmentAdminView,
  listStorefrontCatalogCandidates,
} from "@/lib/storefront/assortment-service";

export const metadata: Metadata = {
  title: "چینش فروشگاهی | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminStorefrontAssortmentPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [tiers, candidates] = await Promise.all([
    getStorefrontAssortmentAdminView(),
    listStorefrontCatalogCandidates(),
  ]);

  return (
    <section className="page-view">
      <PageHeader
        title="چینش فروشگاهی سرور ابری"
        description="برای هر سطح حداکثر ۲۴ پلن اصلی و ۱۲ پلن رزرو از کاتالوگ آروان و پارس‌پک انتخاب کنید. اگر موجودی یک چینش زیر ۱۲ برسد، با پیامک عملیاتی خبر می‌گیرید."
      />
      <StorefrontAssortmentPanel
        initialTiers={tiers}
        candidates={candidates}
      />
    </section>
  );
}
