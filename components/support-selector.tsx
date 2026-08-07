import { ArrowLeft, Check, HeartHandshake, X } from "lucide-react";
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
  PARCHIN_START: "شروع · تحویل امن",
  PARCHIN_ACTIVE: "فعال · راه‌اندازی همراه",
  PARCHIN_STABLE: "پایدار · آماده‌سازی پایداری",
};

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
      {cards.map((contract) => (
        <article key={contract.level} className="support-choice">
          <div>
            <span className="level-icon">
              <HeartHandshake size={25} aria-hidden="true" />
            </span>
            <span>{LEVEL_BADGE[contract.level]}</span>
            <strong>{contract.title}</strong>
            <p>{contract.description}</p>
            {BigInt(contract.monthlyPriceRial || "0") > 0n ? (
              <p>
                هزینه ماهانه خدمات:{" "}
                <strong>{formatTomanFa(BigInt(contract.monthlyPriceRial))} تومان</strong>
              </p>
            ) : null}
            <h3>شامل می‌شود</h3>
            <span className="level-items">
              {contract.includedServices.slice(0, 8).map((item) => (
                <span key={`in-${contract.level}-${item}`}>
                  <Check size={14} aria-hidden="true" /> {item}
                </span>
              ))}
            </span>
            <h3>شامل نمی‌شود</h3>
            <span className="level-items">
              {contract.excludedServices.map((item) => (
                <span key={`ex-${contract.level}-${item}`}>
                  <X size={14} aria-hidden="true" /> {item}
                </span>
              ))}
            </span>
            <small>
              پنجره پشتیبانی: {contract.supportWindow}. هدف پاسخ اولیه:{" "}
              {contract.firstResponseTarget}. محدوده Setup:{" "}
              {contract.serviceLimits.setupScope}. مانیتورینگ ۲۴/۷، بکاپ
              مدیریت‌شده و نگهداری Application جزو این قرارداد نیستند مگر Add-on
              جداگانه.
            </small>
          </div>
        </article>
      ))}
      <div className="support-choice support-choice--cta">
        <p>برای خرید دوره‌ای ماهانه سرور با پرچین، از فهرست سرورها شروع کنید.</p>
        <Link className="button button-primary" href="/cloud-servers">
          مشاهده سرورها
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
