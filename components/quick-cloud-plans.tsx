import {
  ArrowLeft,
  Check,
  Clock3,
  Gauge,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import type { PublicPlanOffer } from "@/lib/orders/plans";

const positionLabels = ["اقتصادی", "پیشنهاد ابرچین", "آماده رشد"] as const;

function formatRialAsToman(value: string) {
  return (BigInt(value) / 10n).toLocaleString("fa-IR");
}

function checkoutHref(planId: string, signedIn: boolean) {
  const next = `/account/order/${planId}`;
  return signedIn ? next : `/login?next=${encodeURIComponent(next)}`;
}

export function QuickCloudPlans({
  plans,
  signedIn,
  compact = false,
}: {
  plans: PublicPlanOffer[];
  signedIn: boolean;
  compact?: boolean;
}) {
  const visiblePlans = plans.slice(0, 3);

  if (visiblePlans.length === 0) {
    return (
      <section className="quick-plans-empty" aria-live="polite">
        <Gauge size={24} aria-hidden="true" />
        <div>
          <strong>چینش‌های آماده در حال به‌روزرسانی‌اند.</strong>
          <p>برای دریافت قیمت قطعی، چند دقیقه دیگر دوباره این صفحه را بررسی کن.</p>
        </div>
      </section>
    );
  }

  return (
    <div className={`quick-plan-grid${compact ? " quick-plan-grid--compact" : ""}`}>
      {visiblePlans.map((plan, index) => {
        const recommended = index === Math.min(1, visiblePlans.length - 1);
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
                {positionLabels[index] ?? "چینش ابری"}
              </span>
              <span className="quick-plan-mode">
                {plan.deliveryMode === "MANAGED" ? "همراه ابرچین" : "خودمدیریتی"}
              </span>
            </header>

            <h3>{plan.title}</h3>
            <p>{plan.description ?? "سرور ابری آماده‌ی شروع و قابل ارتقا."}</p>

            <div className="quick-plan-resources" aria-label="منابع سرور">
              <span><small>پردازنده</small><strong dir="ltr">{plan.vcpu ?? "—"} vCPU</strong></span>
              <span><small>حافظه</small><strong dir="ltr">{plan.ramGb ?? "—"} GB</strong></span>
              <span><small>فضا</small><strong dir="ltr">{plan.storageGb ?? "—"} GB</strong></span>
            </div>

            <div className="quick-plan-price">
              <span><strong>{initial}</strong> تومان</span>
              <small>ماه اول · تمدید {renewal} تومان</small>
            </div>

            <ul>
              <li><Clock3 size={14} aria-hidden="true" /> تحویل حدود {plan.deliveryEstimateMinutes.toLocaleString("fa-IR")} دقیقه</li>
              <li><ShieldCheck size={14} aria-hidden="true" /> پرچین: {plan.parchinIncluded ? "فعال" : "قابل افزودن"}</li>
              <li><Check size={14} aria-hidden="true" /> قابل ارتقا بدون تغییر مسیر خرید</li>
            </ul>

            <details>
              <summary>چرا این پیشنهاد؟</summary>
              <ul className="quick-plan-reasons">
                <li><strong>قیمت:</strong> ماه اول و تمدید جداگانه و شفاف محاسبه شده‌اند.</li>
                <li><strong>عملکرد:</strong> منابع همین کارت مبنای مقایسه‌اند.</li>
                <li><strong>رشد:</strong> جایگاه چینش با ظرفیت موردنیاز برای ادامه مسیر سنجیده شده است.</li>
                <li><strong>ریسک:</strong> زمان تحویل و وضعیت پرچین پیش از انتخاب روشن است.</li>
              </ul>
            </details>

            <Link className="button button-primary" href={checkoutHref(plan.id, signedIn)}>
              انتخاب این چینش
              <ArrowLeft size={17} aria-hidden="true" />
            </Link>
            <small className="quick-plan-validity">
              قیمت تا ۱۰ دقیقه معتبر است و پیش از پرداخت دوباره بررسی می‌شود.
            </small>
          </article>
        );
      })}
    </div>
  );
}
