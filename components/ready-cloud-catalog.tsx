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
import { resolveParchinLevelLabel } from "@/lib/parchin/labels";

function formatRialAsToman(value: string) {
  const rial = BigInt(value);
  const toman = rial / 10n;
  const remainder = rial % 10n;
  return remainder === 0n
    ? toman.toLocaleString("fa-IR")
    : `${toman.toLocaleString("fa-IR")}٫${remainder.toLocaleString("fa-IR")}`;
}

function catalogStatusLabel(status: PublicPlanOffer["catalogStatus"]) {
  if (status === "ACTIVE") return "قیمت و ظرفیت همگام‌شده";
  if (status === "STALE") return "آخرین دادهٔ معتبر؛ نیازمند همگام‌سازی دوباره";
  if (status === "INVALID_PRICE") return "قیمت در دسترس نیست";
  if (status === "INVALID_RESOURCE") return "مشخصات منابع نامعتبر است";
  if (status === "UNAVAILABLE") return "در حال حاضر ناموجود";
  return "نمایش غیرفعال";
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
          <strong>هنوز پلن همگام‌شده‌ای برای نمایش نیست.</strong>
          <p>
            پس از همگام‌سازی موفق کاتالوگ، پلن‌های قیمت‌دار اینجا دیده می‌شوند.
            خرید جدا از نمایش است و تا انتشار محصول و فعال‌شدن فروش بسته می‌ماند.
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
        {visibleOffers.length.toLocaleString("fa-IR")} پلن همگام‌شده
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
                {offer.parchinTitle ??
                  resolveParchinLevelLabel(offer.parchinLevel)}
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
              {offer.salePriceRial && offer.salePriceRial !== "0" ? (
                <span>
                  <strong>{formatRialAsToman(offer.salePriceRial)}</strong>{" "}
                  تومان در ماه
                </span>
              ) : (
                <span>
                  <strong>قیمت ماهانه در دسترس نیست</strong>
                </span>
              )}
              {offer.hourlyPriceRial ? (
                <small>
                  {formatRialAsToman(offer.hourlyPriceRial)} تومان در ساعت
                </small>
              ) : null}
              <small>
                واحد مبدأ:{" "}
                <span dir="ltr">
                  {offer.sourceCurrencyCode ?? "نامشخص"} /{" "}
                  {offer.sourceAmountUnit ?? "نامشخص"}
                </span>
                {" · "}
                واحد نمایش:{" "}
                <span dir="ltr">
                  {offer.normalizedCurrencyCode === "IRR"
                    ? "ریال"
                    : offer.normalizedCurrencyCode}
                </span>
              </small>
            </div>

            <ul>
              <li>
                <Check size={14} aria-hidden="true" />
                {catalogStatusLabel(offer.catalogStatus)}
              </li>
              <li>
                <Check size={14} aria-hidden="true" />
                سیستم‌عامل‌های مجاز: {offer.operatingSystemLabels.join("، ") || offer.imageLabel}
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
              disabledReason={
                offer.purchaseState === "SKU_UNPUBLISHED"
                  ? "هنوز برای فروش منتشر نشده"
                  : offer.purchaseState === "SALE_DISABLED"
                  ? "فروش هنوز فعال نیست"
                  : offer.purchaseState === "REGION_SALE_DISABLED"
                    ? "فروش این موقعیت هنوز فعال نیست"
                  : offer.purchaseState === "CATALOG_STALE"
                    ? "در انتظار همگام‌سازی دوبارهٔ کاتالوگ"
                    : offer.purchaseState === "UNAVAILABLE"
                      ? "در حال حاضر ناموجود"
                    : undefined
              }
            />
            <small className="quick-plan-validity">
              بعد از انتخاب، قیمت برای ۶۰ دقیقه قفل می‌شود.
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
