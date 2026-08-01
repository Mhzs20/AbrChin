"use client";

import {
  Check,
  Clock3,
  Cpu,
  Database,
  MapPin,
  MemoryStick,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ReadyServerQuoteButton } from "@/components/ready-server-quote-button";
import type { PublicPlanOffer } from "@/lib/orders/plans";
import { parchinLevelLabel } from "@/lib/parchin/catalog";

function formatRialAsToman(value: string) {
  return (BigInt(value) / 10n).toLocaleString("fa-IR");
}

export function ReadyCloudCatalog({
  offers,
  productPath = "ready-servers",
}: {
  offers: PublicPlanOffer[];
  productPath?: "cloud-servers" | "ready-servers";
}) {
  const [regionCode, setRegionCode] = useState("ALL");
  const regions = useMemo(() => {
    const map = new Map<string, { code: string; label: string; count: number }>();
    for (const offer of offers) {
      const existing = map.get(offer.regionCode);
      if (existing) existing.count += 1;
      else {
        map.set(offer.regionCode, {
          code: offer.regionCode,
          label: offer.locationLabel,
          count: 1,
        });
      }
    }
    return [...map.values()];
  }, [offers]);
  const visibleOffers =
    regionCode === "ALL"
      ? offers
      : offers.filter((offer) => offer.regionCode === regionCode);

  if (offers.length === 0) {
    return (
      <section className="quick-plans-empty" aria-live="polite">
        <Database size={24} aria-hidden="true" />
        <div>
          <strong>فروش این سرورها موقتاً متوقف است.</strong>
          <p>
            قیمت یا ظرفیت زنده تأیید نشد؛ هیچ قیمت ذخیره‌شده‌ای به‌جای پاسخ
            فعلی نمایش داده نمی‌شود.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="ready-cloud-catalog" aria-label="کاتالوگ زنده سرورهای ابری">
      <div className="ready-cloud-filters" aria-label="فیلتر موقعیت سرور">
        <button
          className={regionCode === "ALL" ? "is-active" : ""}
          onClick={() => setRegionCode("ALL")}
          type="button"
        >
          همه موقعیت‌ها
          <small>{offers.length.toLocaleString("fa-IR")}</small>
        </button>
        {regions.map((region) => (
          <button
            className={regionCode === region.code ? "is-active" : ""}
            key={region.code}
            onClick={() => setRegionCode(region.code)}
            type="button"
          >
            {region.label}
            <small>{region.count.toLocaleString("fa-IR")}</small>
          </button>
        ))}
      </div>

      <p className="ready-cloud-result-count" aria-live="polite">
        {visibleOffers.length.toLocaleString("fa-IR")} سرور ابری موجود
      </p>

      <div className="ready-cloud-grid">
        {visibleOffers.map((offer) => (
          <article className="quick-plan-card ready-cloud-card" key={offer.id}>
            <header>
              <span className="quick-plan-label">
                <MapPin size={14} aria-hidden="true" />
                {offer.locationLabel}
              </span>
              <span className="quick-plan-mode">
                <ShieldCheck size={13} aria-hidden="true" />
                {parchinLevelLabel(offer.parchinLevel)}
              </span>
            </header>

            <div>
              <h3>{offer.title}</h3>
              <p>{offer.imageLabel}</p>
            </div>

            <div className="quick-plan-resources" aria-label="منابع سرور">
              <span>
                <small><Cpu size={12} aria-hidden="true" /> پردازنده</small>
                <strong dir="ltr">{offer.vcpu ?? "—"} vCPU</strong>
              </span>
              <span>
                <small><MemoryStick size={12} aria-hidden="true" /> حافظه</small>
                <strong dir="ltr">{offer.ramGb ?? "—"} GB</strong>
              </span>
              <span>
                <small><Database size={12} aria-hidden="true" /> فضای دیسک</small>
                <strong dir="ltr">{offer.storageGb ?? "—"} GB</strong>
              </span>
            </div>

            <div className="quick-plan-price">
              <span>
                <strong>{formatRialAsToman(offer.salePriceRial)}</strong> تومان
              </span>
              <small>
                ماهانه و تمدید فعلی
                {offer.hourlyPriceRial
                  ? ` · ساعتی ${formatRialAsToman(offer.hourlyPriceRial)} تومان`
                  : ""}
              </small>
            </div>

            <ul>
              <li>
                <Check size={14} aria-hidden="true" />
                {offer.catalogSource === "MANUAL_API_BACKED"
                  ? offer.purchasable
                    ? "پلن دستی است و موجودی آن همین حالا از Provider تأیید شد"
                    : "پلن دستی قابل مشاهده است؛ خرید تا Revalidation Provider متوقف است"
                  : offer.catalogSource === "PREPROVISIONED_INVENTORY"
                    ? `${offer.availableInventory.toLocaleString("fa-IR")} Resource واقعی و سالم آمادهٔ رزرو است`
                  : offer.purchasable
                    ? "قیمت و موجودی در همین بازدید تأیید شده‌اند"
                    : "آخرین اطلاعات سالم نمایش داده شده؛ خرید تا بازیابی ارتباط متوقف است"}
              </li>
              <li>
                <ShieldCheck size={14} aria-hidden="true" />
                تحویل امن و دسترسی یک‌بارمصرف با سطح پرچین نمایش‌داده‌شده
              </li>
              <li>
                <Clock3 size={14} aria-hidden="true" />
                تحویل تقریبی {offer.deliveryEstimateMinutes.toLocaleString("fa-IR")} دقیقه
              </li>
            </ul>

            <ReadyServerQuoteButton
              planId={offer.id}
              productPath={productPath}
              disabled={!offer.purchasable}
            />
            <small className="quick-plan-validity">
              بعد از انتخاب، قیمت و ظرفیت دوباره بررسی و برای ۱۰ دقیقه قفل می‌شود.
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
