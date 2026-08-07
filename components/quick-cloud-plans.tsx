import {
  ArrowLeft,
  Check,
  Clock3,
  Gauge,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { QuoteCountdown } from "@/components/quote-countdown";
import type { PublicPlanOffer } from "@/lib/orders/plans";
import { parchinPlanSummary } from "@/lib/parchin/catalog";
import type { ParchinLevelLabels } from "@/lib/parchin/labels";
import { resolveParchinLevelLabel } from "@/lib/parchin/labels";
import type {
  PublicRecommendationQuote,
  RecommendationOfferRole,
} from "@/lib/recommendation/types";

const positionLabels = ["اقتصادی", "پیشنهاد ابرچین", "آماده رشد"] as const;
const roleLabels: Record<RecommendationOfferRole, string> = {
  ECONOMY: "اقتصادی",
  RECOMMENDED: "پیشنهاد ابرچین",
  GROWTH: "آماده رشد",
};

function formatRialAsToman(value: string) {
  return (BigInt(value) / 10n).toLocaleString("fa-IR");
}

function checkoutHref(id: string, signedIn: boolean, quote: boolean) {
  const next = quote ? `/account/order/quote/${id}` : `/account/order/${id}`;
  return signedIn ? next : `/login?next=${encodeURIComponent(next)}`;
}

export function QuickCloudPlans({
  plans = [],
  quotes = [],
  signedIn,
  compact = false,
  parchinLabels,
}: {
  plans?: PublicPlanOffer[];
  quotes?: PublicRecommendationQuote[];
  signedIn: boolean;
  compact?: boolean;
  parchinLabels?: ParchinLevelLabels;
}) {
  const visiblePlans = (
    quotes.length > 0
      ? quotes.map((quote) => ({
          ...quote,
          salePriceRial: quote.amountRial,
          renewalPriceRial: quote.renewalAmountRial,
          quote: true as const,
        }))
      : plans.map((plan) => ({
          ...plan,
          role: null,
          reasons: null,
          expiresAt: null,
          quote: false as const,
        }))
  ).slice(0, 3);

  if (visiblePlans.length === 0) {
    return (
      <section className="quick-plans-empty" aria-live="polite">
        <Gauge size={24} aria-hidden="true" />
        <div>
          <strong>پیشنهادها در حال به‌روزرسانی‌اند.</strong>
          <p>چند لحظه بعد دوباره بررسی کن یا یک پاسخ گفت‌وگو را تغییر بده.</p>
        </div>
      </section>
    );
  }

  return (
    <div className={`quick-plan-grid${compact ? " quick-plan-grid--compact" : ""}`}>
      {visiblePlans.map((plan, index) => {
        const recommended =
          plan.role === "RECOMMENDED" ||
          (!plan.role && index === Math.min(1, visiblePlans.length - 1));
        const renewal = formatRialAsToman(plan.renewalPriceRial);
        const initial = formatRialAsToman(plan.salePriceRial);
        return (
          <article
            className={`quick-plan-card${recommended ? " is-recommended" : ""}`}
            key={plan.id}
          >
            <header>
              <span className="quick-plan-label">
                {recommended ? <Sparkles size={14} aria-hidden="true" /> : null}
                {plan.role ? roleLabels[plan.role] : positionLabels[index] ?? "چینش ابری"}
              </span>
              <span className="quick-plan-mode">
                پرداخت دوره‌ای
              </span>
            </header>

            <h3>{plan.title}</h3>
            <p>{plan.description ?? "سرور دوره‌ای با قیمت شفاف و تمدید دستی در اختیار خودت."}</p>

            <div className="quick-plan-resources" aria-label="منابع سرور">
              <span><small>پردازنده</small><strong dir="ltr">{plan.vcpu ?? "—"} vCPU</strong></span>
              <span><small>حافظه</small><strong dir="ltr">{plan.ramGb ?? "—"} GB</strong></span>
              <span><small>فضا</small><strong dir="ltr">{plan.storageGb ?? "—"} GB</strong></span>
            </div>

            <div className="quick-plan-price">
              <span><strong>{initial}</strong> تومان</span>
              <small>
                {"termMonths" in plan && typeof plan.termMonths === "number"
                  ? `${plan.termMonths.toLocaleString("fa-IR")} ماهه`
                  : "دوره ثابت"}
                {" · "}
                تمدید دستی فعلی {renewal} تومان
                {"termDiscountBps" in plan &&
                typeof plan.termDiscountBps === "number" &&
                plan.termDiscountBps > 0
                  ? ` · تخفیف ${Math.round(plan.termDiscountBps / 100).toLocaleString("fa-IR")}٪`
                  : ""}
              </small>
            </div>

            <ul>
              <li><Clock3 size={14} aria-hidden="true" /> تحویل حدود {plan.deliveryEstimateMinutes.toLocaleString("fa-IR")} دقیقه</li>
              <li>
                <ShieldCheck size={14} aria-hidden="true" />{" "}
                {"parchinTitle" in plan && plan.parchinTitle
                  ? plan.parchinTitle
                  : resolveParchinLevelLabel(plan.parchinLevel, parchinLabels)}
              </li>
              <li><Check size={14} aria-hidden="true" /> ظرفیت فعلی موجود و قیمت دوباره‌سنجی‌شده</li>
              <li><Check size={14} aria-hidden="true" /> بدون تمدید یا برداشت خودکار</li>
            </ul>

            <details>
              <summary>چرا این پیشنهاد؟</summary>
              <ul className="quick-plan-reasons">
                {plan.reasons ? (
                  plan.reasons.map((reason) => <li key={reason}>{reason}</li>)
                ) : (
                  <>
                    <li><strong>قیمت:</strong> دوره اولیه و تمدید دستی جداگانه و شفاف محاسبه شده‌اند.</li>
                    <li><strong>عملکرد:</strong> منابع همین کارت مبنای مقایسه‌اند.</li>
                    <li><strong>رشد:</strong> جایگاه چینش با ظرفیت موردنیاز برای ادامه مسیر سنجیده شده است.</li>
                    <li><strong>ریسک:</strong> {parchinPlanSummary(plan.parchinIncluded)}</li>
                  </>
                )}
              </ul>
            </details>

            <Link
              className="button button-primary"
              href={checkoutHref(plan.id, signedIn, plan.quote)}
            >
              انتخاب این چینش
              <ArrowLeft size={17} aria-hidden="true" />
            </Link>
            <small className="quick-plan-validity">
              {plan.expiresAt ? (
                <QuoteCountdown expiresAt={plan.expiresAt} />
              ) : (
                "قیمت پس از انتخاب برای ۶۰ دقیقه قفل می‌شود."
              )}
            </small>
          </article>
        );
      })}
    </div>
  );
}
