import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";

import { SupportSelector } from "@/components/support-selector";
import { prisma } from "@/lib/db";
import {
  DEFAULT_PARCHIN_SERVICE_CONTRACTS,
  toParchinServiceContract,
} from "@/lib/parchin/service-contract";

export const metadata: Metadata = {
  title: "پرچین و سطح همراهی | ابرچین",
  description:
    "سه سطح پرچین شروع، استوار و کهکشان با خروجی، تناوب و زمان پاسخ روشن.",
  alternates: { canonical: "/support" },
};

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const rows = await prisma.parchinPricingConfig
    .findMany({
      where: { active: true },
      orderBy: { level: "asc" },
    })
    .catch(() => []);
  const contracts =
    rows.length > 0
      ? rows.map((row) => toParchinServiceContract(row))
      : Object.values(DEFAULT_PARCHIN_SERVICE_CONTRACTS).map((base) => ({
          ...base,
          monthlyPriceRial: "0",
          active: true,
          effectiveFrom: new Date(0).toISOString(),
        }));

  return (
    <section className="support-page page-view" aria-labelledby="support-title">
      <header className="page-heading centered-heading">
        <div className="eyebrow">
          <HeartHandshake size={15} aria-hidden="true" /> عملیات و نگهداری سرور
        </div>
        <h1 id="support-title">پرچین یعنی سرورت بعد از تحویل تنها نمی‌ماند.</h1>
        <p>
          از بازبینی ماهانه تا پایش شبانه‌روزی، بکاپ و مدیریت رخداد؛ هر سطح
          خروجی قابل‌اندازه‌گیری، تناوب مشخص و زمان پاسخ قراردادی دارد. نسخه
          انتخاب‌شده همراه سفارش قفل می‌شود.
        </p>
      </header>
      <div className="support-value-strip" aria-label="تعهدهای پرچین">
        <span>سه سطح پرچین</span>
        <span>تعهد نسخه‌دار روی سفارش</span>
        <span>زمان پاسخ مشخص</span>
      </div>
      <SupportSelector contracts={contracts} />
    </section>
  );
}
