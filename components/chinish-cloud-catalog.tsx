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
import type { StorefrontPublicTier } from "@/lib/storefront/assortment-service";

function formatRialAsToman(value: string) {
  const rial = BigInt(value);
  const toman = rial / 10n;
  const remainder = rial % 10n;
  return remainder === 0n
    ? toman.toLocaleString("fa-IR")
    : `${toman.toLocaleString("fa-IR")}٫${remainder.toLocaleString("fa-IR")}`;
}

function formatRial(value: string) {
  return BigInt(value).toLocaleString("fa-IR");
}

function formatBasisPoints(value: number) {
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return fraction === 0
    ? whole.toLocaleString("fa-IR")
    : `${whole.toLocaleString("fa-IR")}٫${String(fraction)
        .padStart(2, "0")
        .replace(/0$/, "")}`;
}

function catalogStatusLabel(status: PublicPlanOffer["catalogStatus"]) {
  if (status === "ACTIVE") return "قیمت و ظرفیت همگام‌شده";
  if (status === "STALE") return "آخرین دادهٔ معتبر؛ نیازمند همگام‌سازی دوباره";
  if (status === "INVALID_PRICE") return "قیمت در دسترس نیست";
  if (status === "INVALID_RESOURCE") return "مشخصات منابع نامعتبر است";
  if (status === "UNAVAILABLE") return "در حال حاضر ناموجود";
  return "نمایش غیرفعال";
}

function purchaseDisabledReason(offer: PublicPlanOffer) {
  if (offer.purchaseState === "SKU_UNPUBLISHED") {
    return "فروش این پلن‌ها به‌زودی فعال می‌شود";
  }
  if (offer.purchaseState === "SALE_DISABLED") return "فروش هنوز فعال نیست";
  if (offer.purchaseState === "REGION_SALE_DISABLED") {
    return "فروش این موقعیت هنوز فعال نیست";
  }
  if (offer.purchaseState === "CATALOG_STALE") {
    return "در انتظار همگام‌سازی دوبارهٔ کاتالوگ";
  }
  if (offer.purchaseState === "UNAVAILABLE") return "در حال حاضر ناموجود";
  return undefined;
}

export function ChinishCloudCatalog({
  tiers,
}: {
  tiers: StorefrontPublicTier[];
}) {
  const [regionCode, setRegionCode] = useState("ALL");
  const allOffers = useMemo(
    () => tiers.flatMap((tier) => tier.offers),
    [tiers],
  );
  const regions = useMemo(() => {
    const map = new Map<string, { code: string; label: string; count: number }>();
    for (const offer of allOffers) {
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
  }, [allOffers]);

  if (allOffers.length === 0) {
    return (
      <section className="quick-plans-empty" aria-live="polite">
        <Database size={24} aria-hidden="true" />
        <div>
          <strong>چینش فروشگاهی هنوز کامل نشده است.</strong>
          <p>
            پلن‌های چینش نو، استوار و کهکشان پس از انتخاب در پنل مدیریت اینجا
            دیده می‌شوند. می‌توانید مشخصات را ببینید؛ فروش جداگانه فعال می‌شود.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="ready-cloud-catalog" aria-label="چینش سرورهای ابری ابرچین">
      <div className="ready-cloud-filters" aria-label="فیلتر موقعیت سرور">
        <button
          className={regionCode === "ALL" ? "is-active" : ""}
          onClick={() => setRegionCode("ALL")}
          type="button"
        >
          همه موقعیت‌ها
          <small>{allOffers.length.toLocaleString("fa-IR")}</small>
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

      {tiers.map((tier) => {
        const offers =
          regionCode === "ALL"
            ? tier.offers
            : tier.offers.filter((offer) => offer.regionCode === regionCode);
        return (
          <section
            key={tier.tier}
            className="chinish-tier"
            aria-labelledby={`tier-${tier.tier}`}
            style={{ marginTop: 28 }}
          >
            <header style={{ marginBottom: 12 }}>
              <h2 id={`tier-${tier.tier}`} style={{ margin: 0 }}>
                {tier.label}
              </h2>
              <p style={{ marginTop: 8, color: "var(--product-muted)" }}>
                {tier.description}
              </p>
              <p className="ready-cloud-result-count" aria-live="polite">
                {offers.length.toLocaleString("fa-IR")} پلن در این چینش
              </p>
            </header>

            {offers.length === 0 ? (
              <p style={{ color: "var(--product-muted)" }}>
                در این فیلتر هنوز پلنی برای این چینش نیست.
              </p>
            ) : (
              <div className="ready-cloud-grid">
                {offers.map((offer) => (
                  <article
                    className="quick-plan-card ready-cloud-card"
                    key={`${tier.tier}-${offer.id}`}
                  >
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
                        <small>
                          <Cpu size={12} aria-hidden="true" /> پردازنده
                        </small>
                        <strong dir="ltr">{offer.vcpu ?? "—"} vCPU</strong>
                      </span>
                      <span>
                        <small>
                          <MemoryStick size={12} aria-hidden="true" /> حافظه
                        </small>
                        <strong dir="ltr">{offer.ramGb ?? "—"} GB</strong>
                      </span>
                      <span>
                        <small>
                          <Database size={12} aria-hidden="true" /> فضای دیسک
                        </small>
                        <strong dir="ltr">{offer.storageGb ?? "—"} GB</strong>
                      </span>
                    </div>

                    <div className="quick-plan-price">
                      {offer.hourlyPriceRial &&
                      offer.providerBaseHourlyPriceRial ? (
                        <>
                          <span>
                            <strong>
                              {formatRialAsToman(offer.hourlyPriceRial)}
                            </strong>{" "}
                            تومان در ساعت
                          </span>
                          <small>
                            قیمت پایه تأمین‌کننده:{" "}
                            {formatRial(offer.providerBaseHourlyPriceRial)} ریال
                            در ساعت
                          </small>
                          <small>
                            برآورد ۲۴ ساعت پس از سود{" "}
                            {formatBasisPoints(offer.markupBasisPoints)}٪:{" "}
                            {formatRialAsToman(
                              (
                                BigInt(offer.hourlyPriceRial) * 24n
                              ).toString(),
                            )}{" "}
                            تومان
                          </small>
                        </>
                      ) : (
                        <>
                          <span>
                            <strong>قیمت ساعتی در دسترس نیست</strong>
                          </span>
                          <small>
                            هیچ مبلغی تخمین زده یا جایگزین نشده است.
                          </small>
                        </>
                      )}
                    </div>

                    <ul>
                      <li>
                        <Check size={14} aria-hidden="true" />
                        {catalogStatusLabel(offer.catalogStatus)}
                      </li>
                      <li>
                        <Check size={14} aria-hidden="true" />
                        سیستم‌عامل‌های مجاز:{" "}
                        {offer.operatingSystemLabels.join("، ") ||
                          offer.imageLabel}
                      </li>
                      <li>
                        <ShieldCheck size={14} aria-hidden="true" />
                        تحویل امن با پرچین
                      </li>
                      <li>
                        <Clock3 size={14} aria-hidden="true" />
                        تحویل تقریبی{" "}
                        {offer.deliveryEstimateMinutes.toLocaleString("fa-IR")}{" "}
                        دقیقه
                      </li>
                    </ul>

                    <ReadyServerQuoteButton
                      planId={offer.id}
                      productPath="cloud-servers"
                      disabled={!offer.purchasable}
                      disabledReason={purchaseDisabledReason(offer)}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}
