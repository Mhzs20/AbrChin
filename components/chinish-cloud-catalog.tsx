"use client";

import {
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
import type { StorefrontPublicTier } from "@/lib/storefront/assortment-service";
import {
  formatStorefrontToman,
  storefrontLocationZone,
} from "@/lib/storefront/presentation";

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

type LocationFilter = "ALL" | "IRAN" | "ABROAD";

export function ChinishCloudCatalog({
  tiers,
}: {
  tiers: StorefrontPublicTier[];
}) {
  const [activeTier, setActiveTier] = useState(tiers[0]?.tier ?? "NO");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("ALL");

  const tier =
    tiers.find((item) => item.tier === activeTier) ?? tiers[0] ?? null;

  const filteredOffers = useMemo(() => {
    if (!tier) return [];
    if (locationFilter === "ALL") return tier.offers;
    return tier.offers.filter(
      (offer) =>
        storefrontLocationZone(offer.regionCode, {
          title: offer.title,
          locationLabel: offer.locationLabel,
        }) === locationFilter,
    );
  }, [locationFilter, tier]);

  const locationCounts = useMemo(() => {
    const offers = tier?.offers ?? [];
    let iran = 0;
    let abroad = 0;
    for (const offer of offers) {
      if (
        storefrontLocationZone(offer.regionCode, {
          title: offer.title,
          locationLabel: offer.locationLabel,
        }) === "IRAN"
      ) {
        iran += 1;
      } else {
        abroad += 1;
      }
    }
    return { all: offers.length, iran, abroad };
  }, [tier]);

  if (!tier || tiers.every((item) => item.offers.length === 0)) {
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
      <div className="ready-cloud-filters" aria-label="چینش سرور">
        {tiers.map((item) => (
          <button
            className={item.tier === activeTier ? "is-active" : ""}
            key={item.tier}
            onClick={() => {
              setActiveTier(item.tier);
              setLocationFilter("ALL");
            }}
            type="button"
          >
            {item.label}
            <small>{item.availableCount.toLocaleString("fa-IR")}</small>
          </button>
        ))}
      </div>

      <p style={{ marginTop: 12, color: "var(--product-muted)" }}>
        {tier.description}
      </p>

      <div
        className="ready-cloud-filters"
        aria-label="لوکیشن سرور"
        style={{ marginTop: 16 }}
      >
        <button
          className={locationFilter === "ALL" ? "is-active" : ""}
          onClick={() => setLocationFilter("ALL")}
          type="button"
        >
          همه لوکیشن‌ها
          <small>{locationCounts.all.toLocaleString("fa-IR")}</small>
        </button>
        <button
          className={locationFilter === "IRAN" ? "is-active" : ""}
          onClick={() => setLocationFilter("IRAN")}
          type="button"
        >
          لوکیشن ایران
          <small>{locationCounts.iran.toLocaleString("fa-IR")}</small>
        </button>
        <button
          className={locationFilter === "ABROAD" ? "is-active" : ""}
          onClick={() => setLocationFilter("ABROAD")}
          type="button"
        >
          لوکیشن خارج
          <small>{locationCounts.abroad.toLocaleString("fa-IR")}</small>
        </button>
      </div>

      <p className="ready-cloud-result-count" aria-live="polite">
        {filteredOffers.length.toLocaleString("fa-IR")} پلن در این چینش
      </p>

      {filteredOffers.length === 0 ? (
        <p style={{ color: "var(--product-muted)" }}>
          در این فیلتر هنوز پلنی برای این چینش نیست.
        </p>
      ) : (
        <div className="ready-cloud-grid">
          {filteredOffers.map((offer) => (
            <article
              className="quick-plan-card ready-cloud-card"
              key={`${tier.tier}-${offer.id}`}
            >
              <header>
                <span className="quick-plan-label">
                  <MapPin size={14} aria-hidden="true" />
                  {offer.locationLabel}
                </span>
                <span
                  className="provider-code-badge"
                  data-code={offer.providerCode}
                  title="کد منبع"
                >
                  {offer.providerCode}
                </span>
                <span className="quick-plan-mode">
                  <ShieldCheck size={13} aria-hidden="true" />
                  {offer.parchinTitle ??
                    resolveParchinLevelLabel(offer.parchinLevel)}
                </span>
              </header>

              <div>
                <h3>{offer.title}</h3>
              </div>

              <div>
                <strong style={{ display: "block", marginBottom: 8 }}>
                  چینش فنی
                </strong>
                <div className="quick-plan-resources" aria-label="چینش فنی">
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
              </div>

              <div className="quick-plan-price">
                {offer.salePriceRial && offer.salePriceRial !== "0" ? (
                  <span>
                    <strong>{formatStorefrontToman(offer.salePriceRial)}</strong>{" "}
                    تومان در ماه
                  </span>
                ) : (
                  <span>
                    <strong>قیمت ماهانه در دسترس نیست</strong>
                  </span>
                )}
                {offer.hourlyPriceRial ? (
                  <small>
                    {formatStorefrontToman(offer.hourlyPriceRial)} تومان در ساعت
                  </small>
                ) : null}
              </div>

              <ul>
                <li>
                  <ShieldCheck size={14} aria-hidden="true" />
                  امن و آمادهٔ راه‌اندازی با پرچین
                </li>
                <li>
                  <Clock3 size={14} aria-hidden="true" />
                  زمان تحویل تقریبی: فوری
                </li>
              </ul>

              <ReadyServerQuoteButton
                planId={offer.id}
                productPath={
                  offer.productKind === "READY_INSTANT_SERVER"
                    ? "ready-servers"
                    : "cloud-servers"
                }
                disabled={!offer.purchasable}
                disabledReason={purchaseDisabledReason(offer)}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
