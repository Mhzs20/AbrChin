import { Cloud, Compass, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ChinishCloudCatalog } from "@/components/chinish-cloud-catalog";
import { getCurrentUser } from "@/lib/session";
import { listPublicStorefrontTiers } from "@/lib/storefront/assortment-service";
import {
  STOREFRONT_TIERS,
  storefrontTierDescription,
  storefrontTierLabel,
} from "@/lib/storefront/tiers";

export const metadata: Metadata = {
  title: "سرور ابری ابرچین | چینش نو، استوار، کهکشان",
  description:
    "سرور ابری با خرید دوره‌ای ماهانه، قیمت شفاف و تحویل امن با پرچین. دوره‌های ۱، ۳، ۶ و ۱۲ ماهه.",
  alternates: { canonical: "/cloud-servers" },
};

export const dynamic = "force-dynamic";

function unavailableCatalog() {
  return {
    live: false,
    degraded: true,
    checkedAt: null,
    priceDisplay: {
      showHourlyPrice: false,
      showDailyPrice: false,
      showMonthlyPrice: true,
    },
    tiers: STOREFRONT_TIERS.map((tier) => ({
      tier,
      label: storefrontTierLabel(tier),
      description: storefrontTierDescription(tier),
      availableCount: 0,
      offers: [],
    })),
  };
}

export default async function CloudServersPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const [catalog, user, { plan }] = await Promise.all([
    // Public discovery stays available during a database incident, while sale
    // fails closed: no cached or invented SKU is ever rendered as purchasable.
    listPublicStorefrontTiers().catch(unavailableCatalog),
    getCurrentUser(),
    searchParams,
  ]);
  return (
    <section className="quick-buy-page page-view" aria-labelledby="quick-buy-title">
      <header className="quick-buy-heading">
        <div>
          <span className="eyebrow">
            <Cloud size={15} aria-hidden="true" /> سرور ابری ابرچین
          </span>
          <h1 id="quick-buy-title">
            سروری را انتخاب کن که همین حالا قابل خرید است.
          </h1>
          <p>
            سه چینش بر اساس توان سرور ساخته شده‌اند. قیمت نمایش‌داده‌شده مبلغ
            یک ماه است؛ مدت، سیستم‌عامل، نام سرور و کد تخفیف را در مرحله بعد
            انتخاب می‌کنی.
          </p>
        </div>
        <Link className="button button-quiet" href="/compass">
          <Compass size={16} aria-hidden="true" />
          قطب‌نما برای انتخاب مطمئن
        </Link>
      </header>

      <div className="quick-buy-strip">
        <span>
          <Wallet size={15} aria-hidden="true" /> خرید دوره‌ای ۱ / ۳ / ۶ / ۱۲ ماهه
        </span>
        <span>
          <ShieldCheck size={15} aria-hidden="true" /> فقط پلن قابل‌خرید و تحویل ادمین‌محور
        </span>
      </div>

      <ChinishCloudCatalog
        tiers={catalog.tiers}
        isAuthenticated={Boolean(user)}
        autoExpandPlanId={typeof plan === "string" && plan ? plan : null}
      />
    </section>
  );
}
