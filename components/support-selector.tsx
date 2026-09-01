import {
  Activity,
  ArrowLeft,
  Check,
  Clock3,
  DatabaseBackup,
  HeartHandshake,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import type { PublicParchinCatalog } from "@/lib/parchin/availability";
import { formatTomanFa } from "@/lib/money";

const LEVEL_ORDER = [
  "PARCHIN_START",
  "PARCHIN_ACTIVE",
  "PARCHIN_STABLE",
] as const;

const LEVEL_BADGE: Record<(typeof LEVEL_ORDER)[number], string> = {
  PARCHIN_START: "برای شروع مطمئن",
  PARCHIN_ACTIVE: "برای سرویس در حال رشد",
  PARCHIN_STABLE: "برای عملیات حساس",
};

const LEVEL_ICON = {
  PARCHIN_START: ShieldCheck,
  PARCHIN_ACTIVE: Activity,
  PARCHIN_STABLE: DatabaseBackup,
} as const;

export function SupportSelector({
  catalog,
}: {
  catalog: PublicParchinCatalog;
}) {
  const cards = LEVEL_ORDER.map(
    (level) => catalog.contracts.find((row) => row.level === level) ?? null,
  ).filter((row) => row !== null);

  return (
    <div className="support-workspace support-workspace--tiers">
      <div className="support-contract-grid">
        {cards.map((contract) => {
          const Icon = LEVEL_ICON[contract.level];
          const highlights = contract.includedServices.slice(-6);
          return (
            <article
              key={contract.level}
              className={`support-contract-card support-contract-card--${contract.level.toLowerCase()}${
                contract.sellable && contract.level === "PARCHIN_ACTIVE"
                  ? " is-recommended"
                  : ""
              }${contract.sellable ? "" : " is-unavailable"}`}
            >
              {contract.sellable && contract.level === "PARCHIN_ACTIVE" ? (
                <span className="support-recommended">انتخاب متعادل</span>
              ) : null}
              {!contract.sellable ? (
                <span className="support-unavailable-badge">غیرفعال / در انتظار شواهد</span>
              ) : null}
              <header>
                <span className="support-contract-icon">
                  <Icon size={24} aria-hidden="true" />
                </span>
                <div>
                  <span className="support-contract-audience">
                    {LEVEL_BADGE[contract.level]}
                  </span>
                  <h2>{contract.title}</h2>
                </div>
              </header>

              <p className="support-contract-description">{contract.description}</p>

              <div className="support-contract-price">
                {contract.sellable && BigInt(contract.monthlyPriceRial || "0") > 0n ? (
                  <>
                    <strong>{formatTomanFa(BigInt(contract.monthlyPriceRial))}</strong>
                    <span>تومان / ماه</span>
                  </>
                ) : (
                  <strong>برای فروش عمومی آماده نیست</strong>
                )}
              </div>

              <div className="support-contract-metrics">
                <span>
                  <Clock3 size={15} aria-hidden="true" />
                  <small>زمان پاسخ</small>
                  <strong>{contract.firstResponseTarget}</strong>
                </span>
                <span>
                  <HeartHandshake size={15} aria-hidden="true" />
                  <small>پنجره خدمت</small>
                  <strong>{contract.supportWindow}</strong>
                </span>
              </div>

              <h3>{contract.sellable ? "نتیجه‌ای که تحویل می‌گیری" : "وضعیت فعلی"}</h3>
              <ul className="support-contract-outcomes">
                {highlights.map((item) => (
                  <li key={`${contract.level}-${item}`}>
                    <Check size={15} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <details className="support-contract-boundary">
                <summary>مرز تعهد این سطح</summary>
                <p>{contract.serviceLimits.setupScope}</p>
                <ul>
                  {contract.excludedServices.map((item) => (
                    <li key={`boundary-${contract.level}-${item}`}>{item}</li>
                  ))}
                </ul>
              </details>
            </article>
          );
        })}
      </div>

      <div className="support-purchase-cta">
        <div>
          <span>سرور ابری</span>
          <strong>
            {catalog.status === "available"
              ? "پلن را انتخاب کن؛ مبلغ دقیق پرچین قبل از پرداخت شفاف است."
              : "الان می‌توانی سرور را ببینی؛ سطح پرچین تأییدنشده قابل خرید نیست."}
          </strong>
        </div>
        <Link className="button button-primary" href="/cloud-servers">
          انتخاب سرور
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </div>

      {catalog.status === "available" ? (
        <section className="support-contract-definitions" aria-labelledby="parchin-definitions-title">
          <h2 id="parchin-definitions-title">تعریف دقیق خدمات</h2>
          <p>
            این تعریف‌ها روی نسخه قرارداد سفارش قفل می‌شوند تا مشتری و تیم عملیات
            دقیقاً یک برداشت داشته باشند.
          </p>
          <dl>
            <div><dt>ساعات کاری</dt><dd>{cards[0]?.definitions.businessHours}</dd></div>
            <div><dt>پاسخ اولیه</dt><dd>{cards[0]?.definitions.firstResponse}</dd></div>
            <div><dt>رخداد P1</dt><dd>{cards[0]?.definitions.p1Incident}</dd></div>
            <div><dt>درخواست روتین</dt><dd>{cards[0]?.definitions.routineRequest}</dd></div>
            <div><dt>خارج از سهمیه روتین</dt><dd>{cards[0]?.definitions.routineExclusions}</dd></div>
            <div><dt>بکاپ روزانه</dt><dd>{cards[0]?.definitions.backup}</dd></div>
            <div><dt>بررسی Restore</dt><dd>{cards[0]?.definitions.restoreCheck}</dd></div>
            <div><dt>آزمون Restore</dt><dd>{cards[0]?.definitions.restoreTest}</dd></div>
            <div><dt>مدیریت تغییر</dt><dd>{cards[0]?.definitions.changeManagement}</dd></div>
            <div><dt>مرز Application</dt><dd>{cards[0]?.definitions.applicationBoundary}</dd></div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
