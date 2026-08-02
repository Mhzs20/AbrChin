import { Box, Compass, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ReadyCloudCatalog } from "@/components/ready-cloud-catalog";
import { listLiveReadyServerOffers } from "@/lib/orders/plans";

export const metadata: Metadata = {
  title: "سرورهای آماده و تحویل فوری | ابرچین",
  description:
    "سرورهای آماده با مشخصات ثابت، قیمت معتبر، پرچین اجباری و تحویل فوری.",
  alternates: { canonical: "/ready-servers" },
};

export const dynamic = "force-dynamic";

export default async function ReadyServersPage() {
  const catalog = await listLiveReadyServerOffers();
  const checkedAt = catalog.checkedAt
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(catalog.checkedAt))
    : "ناموفق";

  return (
    <section className="quick-buy-page page-view" aria-labelledby="ready-title">
      <header className="quick-buy-heading">
        <div>
          <span className="eyebrow">
            <Box size={15} aria-hidden="true" /> سرور آماده و تحویل فوری
          </span>
          <h1 id="ready-title">مشخصات ثابت، قیمت زنده و تحویل سریع.</h1>
          <p>
            فقط Region، Size و Image معتبر Catalog نمایش داده می‌شوند؛ منابع
            سفارشی و Slider در این مسیر وجود ندارند.
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
          <Zap size={15} aria-hidden="true" /> تحویل فوری
        </span>
        <span>
          <ShieldCheck size={15} aria-hidden="true" /> پرچین اجباری
        </span>
      </div>

      <ReadyCloudCatalog offers={catalog.offers} productPath="ready-servers" />
    </section>
  );
}
