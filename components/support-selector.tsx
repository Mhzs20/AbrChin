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

import {
  DEFAULT_PARCHIN_SERVICE_CONTRACTS,
  type ParchinServiceContract,
} from "@/lib/parchin/service-contract";
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

const LEVEL_HIGHLIGHT_COUNT = {
  PARCHIN_START: 6,
  PARCHIN_ACTIVE: 7,
  PARCHIN_STABLE: 8,
} as const;

export function SupportSelector({
  contracts,
}: {
  contracts: ParchinServiceContract[];
}) {
  const byLevel = new Map(contracts.map((row) => [row.level, row]));
  const cards = LEVEL_ORDER.map((level) => {
    const fallback = DEFAULT_PARCHIN_SERVICE_CONTRACTS[level];
    const live = byLevel.get(level);
    return live ?? {
      ...fallback,
      monthlyPriceRial: "0",
      active: true,
      effectiveFrom: new Date(0).toISOString(),
    };
  });

  return (
    <div className="support-workspace support-workspace--tiers">
      <div className="support-contract-grid">
        {cards.map((contract) => {
          const Icon = LEVEL_ICON[contract.level];
          const highlights = contract.includedServices.slice(
            -LEVEL_HIGHLIGHT_COUNT[contract.level],
          );
          return (
            <article
              key={contract.level}
              className={`support-contract-card support-contract-card--${contract.level.toLowerCase()}${
                contract.level === "PARCHIN_ACTIVE" ? " is-recommended" : ""
              }`}
            >
              {contract.level === "PARCHIN_ACTIVE" ? (
                <span className="support-recommended">انتخاب متعادل</span>
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
                {BigInt(contract.monthlyPriceRial || "0") > 0n ? (
                  <>
                    <strong>{formatTomanFa(BigInt(contract.monthlyPriceRial))}</strong>
                    <span>تومان / ماه</span>
                  </>
                ) : (
                  <strong>قیمت در سفارش</strong>
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

              <h3>نتیجه‌ای که تحویل می‌گیری</h3>
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
          <span>سرور + قرارداد عملیاتی</span>
          <strong>پلن را انتخاب کن؛ مبلغ دقیق پرچین قبل از پرداخت شفاف است.</strong>
        </div>
        <Link className="button button-primary" href="/cloud-servers">
          انتخاب سرور
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
