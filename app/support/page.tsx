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
    "سه سطح پرچین شروع، فعال و پایدار با دامنه خدمات، محدودیت‌ها و پشتیبانی واقعی.",
  alternates: { canonical: "/support" },
};

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const rows = await prisma.parchinPricingConfig.findMany({
    where: { active: true },
    orderBy: { level: "asc" },
  });
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
          <HeartHandshake size={15} aria-hidden="true" /> سطح همراهی
        </div>
        <h1 id="support-title">سه سطح پرچین، با دامنه روشن خدمات.</h1>
        <p>
          هر سرور ابری ابرچین با یکی از سطوح پرچین تحویل می‌شود. آنچه در قرارداد
          سطح آمده قابل اتکاست؛ خدمات خارج از دامنه (مانیتورینگ ۲۴/۷، بکاپ
          مدیریت‌شده، نگهداری Application) وعده داده نمی‌شود.
        </p>
      </header>
      <SupportSelector contracts={contracts} />
    </section>
  );
}
