import { Cloud, Compass, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ReadyCloudCatalog } from "@/components/ready-cloud-catalog";
import { listLiveCloudServerOffers } from "@/lib/orders/plans";

export const metadata: Metadata = {
  title: "سرور ابری قابل انتخاب | ابرچین",
  description:
    "همه ظرفیت‌های معتبر و قیمت‌دار سرور ابری، با پرچین و تحویل امن از ابرچین.",
  alternates: { canonical: "/cloud-servers" },
};

export const dynamic = "force-dynamic";

export default async function CloudServersPage() {
  const catalog = await listLiveCloudServerOffers();
  const checkedAt = catalog.checkedAt
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(catalog.checkedAt))
    : "ناموفق";

  return (
    <section className="quick-buy-page page-view" aria-labelledby="quick-buy-title">
      <header className="quick-buy-heading">
        <div>
          <span className="eyebrow">
            <Cloud size={15} aria-hidden="true" /> سرورهای ابری قابل انتخاب
          </span>
          <h1 id="quick-buy-title">
            منابع را انتخاب کن؛ مصرف را از کیف پول بپرداز.
          </h1>
          <p>
            کاتالوگ همگام‌شدهٔ سرور ابری را ببین. خرید فقط وقتی فعال است که
            ادمین SKU را منتشر کرده باشد و فروش عمومی روشن باشد؛ پیش از برآورد
            قیمت دوباره اعتبارسنجی می‌شود.
          </p>
        </div>
        <Link className="button button-quiet" href="/compass">
          <Compass size={16} aria-hidden="true" />
          برای انتخاب کمک می‌خوام
        </Link>
      </header>

      <div className="quick-buy-strip">
        <span>
          <RefreshCw size={15} aria-hidden="true" />
          {catalog.degraded ? " نیازمند بررسی دوباره: " : " آخرین بررسی: "}
          {checkedAt}
        </span>
        <span>
          <Zap size={15} aria-hidden="true" /> برآورد ساعتی و روزانه
        </span>
        <span>
          <ShieldCheck size={15} aria-hidden="true" /> همه سرورها با پرچین
        </span>
      </div>

      <ReadyCloudCatalog offers={catalog.offers} productPath="cloud-servers" />
    </section>
  );
}
