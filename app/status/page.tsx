import { Activity, CheckCircle2, Database, Workflow } from "lucide-react";
import type { Metadata } from "next";

import {
  getPlatformReadiness,
  type ReadinessComponentStatus,
} from "@/lib/monitoring/readiness";

export const metadata: Metadata = {
  title: "وضعیت سرویس | ابرچین",
  description: "وضعیت زنده وب‌سایت، دیتابیس و پردازش سفارش‌های ابرچین.",
  alternates: { canonical: "/status" },
};

export const dynamic = "force-dynamic";

const labels: Record<ReadinessComponentStatus, string> = {
  healthy: "سالم",
  stale: "با تأخیر",
  down: "قطع",
  unknown: "نامشخص",
};

export default async function StatusPage() {
  const readiness = await getPlatformReadiness();
  const headline =
    readiness.status === "operational"
      ? "همه‌ی بخش‌های اصلی عملیاتی‌اند."
      : readiness.status === "degraded"
        ? "بخشی از سامانه با تأخیر پاسخ می‌دهد."
        : "یک اختلال عملیاتی شناسایی شده.";

  const components = [
    {
      title: "وب‌سایت و حساب",
      description: "ورود، مشاهده سفارش و پرداخت",
      status: readiness.components.web,
      icon: CheckCircle2,
    },
    {
      title: "دیتابیس",
      description: "اطلاعات حساب، سفارش و کیف پول",
      status: readiness.components.database,
      icon: Database,
    },
    {
      title: "پردازش سفارش",
      description: "صف تأمین و آماده‌سازی سرور",
      status: readiness.components.provisioningWorker,
      icon: Workflow,
    },
    {
      title: "تسویهٔ دوره‌های Billing",
      description: "ثبت دوره‌های بسته و Catch-up محدود",
      status: readiness.components.billingCatchUp,
      icon: Activity,
    },
    {
      title: "قراردادهای Billing Provider",
      description: "نسخه و تأیید قراردادهای آروان و پارس‌پک",
      status: readiness.components.billingContracts,
      icon: CheckCircle2,
    },
  ];

  return (
    <section className="status-page page-view" aria-labelledby="status-title">
      <header className="page-heading centered-heading">
        <div className="eyebrow">
          <Activity size={15} aria-hidden="true" />
          وضعیت زنده‌ی پلتفرم
        </div>
        <h1 id="status-title">{headline}</h1>
        <p>
          این صفحه سلامت خود ابرچین را نشان می‌دهد؛ پایش سرور مشتری فقط با سرویس
          جداگانه و ثبت‌شده در سفارش انجام می‌شود.
        </p>
      </header>

      <div className="status-grid">
        {components.map((component) => {
          const Icon = component.icon;
          return (
            <article key={component.title}>
              <span className="status-icon">
                <Icon size={23} aria-hidden="true" />
              </span>
              <div>
                <h2>{component.title}</h2>
                <p>{component.description}</p>
              </div>
              <span className={`status-pill status-pill--${component.status}`}>
                {labels[component.status]}
              </span>
            </article>
          );
        })}
      </div>

      <p className="status-checked-at">
        آخرین بررسی:{" "}
        <time dateTime={readiness.checkedAt}>
          {new Intl.DateTimeFormat("fa-IR", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Tehran",
          }).format(new Date(readiness.checkedAt))}
        </time>
      </p>
    </section>
  );
}
