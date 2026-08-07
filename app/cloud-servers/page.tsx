import { Cloud, Compass, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ChinishCloudCatalog } from "@/components/chinish-cloud-catalog";
import { getCurrentUser } from "@/lib/session";
import { listPublicStorefrontTiers } from "@/lib/storefront/assortment-service";

export const metadata: Metadata = {
  title: "سرور ابری ابرچین | چینش نو، استوار، کهکشان",
  description:
    "سرور ابری با خرید دوره‌ای ماهانه، قیمت شفاف و تحویل امن با پرچین. دوره‌های ۱، ۳، ۶ و ۱۲ ماهه.",
  alternates: { canonical: "/cloud-servers" },
};

export const dynamic = "force-dynamic";

export default async function CloudServersPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const [catalog, user, { plan }] = await Promise.all([
    listPublicStorefrontTiers(),
    getCurrentUser(),
    searchParams,
  ]);
  const checkedAt = catalog.checkedAt
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(catalog.checkedAt))
    : "نامشخص";

  return (
    <section className="quick-buy-page page-view" aria-labelledby="quick-buy-title">
      <header className="quick-buy-heading">
        <div>
          <span className="eyebrow">
            <Cloud size={15} aria-hidden="true" /> سرور ابری ابرچین
          </span>
          <h1 id="quick-buy-title">
            سرور ابری را انتخاب کنید و دوره را پیش‌پرداخت کنید.
          </h1>
          <p>
            پلن‌ها در سه چینش نو، استوار و کهکشان چیده شده‌اند. مبلغ قابل‌پرداخت
            ماهانه است؛ دوره‌های ۳ / ۶ / ۱۲ ماهه تا سقف تخفیف اعلامی دارند و تحویل
            با پرچین انجام می‌شود.
          </p>
        </div>
        <Link className="button button-quiet" href="/compass">
          <Compass size={16} aria-hidden="true" />
          برای انتخاب مطمئن‌تر راهنمایی بگیر
        </Link>
      </header>

      <div className="quick-buy-strip">
        <span>
          <RefreshCw size={15} aria-hidden="true" />
          {catalog.degraded ? " نیازمند بررسی دوباره: " : " آخرین بررسی: "}
          {checkedAt}
        </span>
        <span>
          <Wallet size={15} aria-hidden="true" /> خرید دوره‌ای ۱ / ۳ / ۶ / ۱۲ ماهه
        </span>
        <span>
          <ShieldCheck size={15} aria-hidden="true" /> تحویل امن با پرچین
        </span>
      </div>

      <ChinishCloudCatalog
        tiers={catalog.tiers}
        priceDisplay={catalog.priceDisplay}
        isAuthenticated={Boolean(user)}
        autoExpandPlanId={typeof plan === "string" && plan ? plan : null}
      />
    </section>
  );
}
