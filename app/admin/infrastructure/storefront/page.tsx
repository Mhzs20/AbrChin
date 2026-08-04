import type { Metadata } from "next";

import { StorefrontAssortmentPanel } from "@/components/admin/storefront-assortment-panel";
import { PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import {
  getStorefrontAssortmentAdminView,
  listStorefrontCatalogCandidates,
} from "@/lib/storefront/assortment-service";
import {
  getStorefrontAssortmentSettings,
  toStorefrontSettingsView,
} from "@/lib/storefront/auto-suggest";

export const metadata: Metadata = {
  title: "چینش فروشگاهی | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminStorefrontAssortmentPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [tiers, candidates, settings] = await Promise.all([
    getStorefrontAssortmentAdminView(),
    listStorefrontCatalogCandidates(),
    getStorefrontAssortmentSettings(),
  ]);

  return (
    <section className="page-view">
      <PageHeader
        title="چینش فروشگاهی سرور ابری"
        description="می‌توانید پیشنهاد خودکار را روشن کنید تا برای چینش نو، استوار و کهکشان پلن‌های اصلی و رزرو انتخاب شوند؛ یا خودتان ویرایش و ذخیره کنید."
      />
      <StorefrontAssortmentPanel
        initialTiers={tiers}
        candidates={candidates}
        initialSettings={toStorefrontSettingsView(settings)}
      />
    </section>
  );
}
