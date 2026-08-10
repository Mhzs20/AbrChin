import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ParchinUpgradeRequest } from "@/components/account/parchin-upgrade-request";
import {
  Breadcrumb,
  PageHeader,
  SectionCard,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { parchinLevelLabel } from "@/lib/parchin/catalog";
import { parchinLevelRank } from "@/lib/parchin/recommendation";
import { getCustomerParchinEnrollment } from "@/lib/parchin/service";
import { readParchinServiceSnapshot } from "@/lib/parchin/service-contract";
import { WalletError } from "@/lib/wallet/errors";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "جزئیات پرچین | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const TASK_STATUS: Record<string, string> = {
  TODO: "برنامه‌ریزی‌شده",
  IN_PROGRESS: "در حال انجام",
  BLOCKED: "نیازمند پیگیری",
  COMPLETED: "انجام‌شده",
  CANCELED: "لغوشده",
};

const ENROLLMENT_STATUS: Record<string, string> = {
  ACTIVE: "فعال",
  PAST_DUE: "سررسیدشده",
  SUSPENDED: "تعلیق‌شده",
  CANCELED: "لغوشده",
  ENDED: "پایان‌یافته",
};

const REPORT_TYPE: Record<string, string> = {
  HEALTH: "سلامت",
  OPERATIONS: "عملیات",
  RESTORE: "بازیابی",
  SECURITY: "امنیت",
  CAPACITY: "ظرفیت",
  INCIDENT: "رخداد",
};

const DEFINITION_LABELS: Record<string, string> = {
  businessHours: "ساعت کاری",
  firstResponse: "پاسخ اولیه",
  p1Incident: "رخداد P1",
  routineRequest: "درخواست روتین",
  routineExclusions: "خارج از درخواست روتین",
  backup: "بکاپ",
  restoreCheck: "بررسی قابلیت بازیابی",
  restoreTest: "آزمون بازیابی",
  changeManagement: "مدیریت تغییر",
  applicationBoundary: "مرز اپلیکیشن",
};

const REPORT_METRIC_LABELS: Record<string, string> = {
  uptimePercent: "Uptime",
  cpuAveragePercent: "میانگین CPU",
  ramPeakPercent: "اوج RAM",
  diskUsedPercent: "فضای Disk مصرف‌شده",
  backupSuccessRatePercent: "موفقیت بکاپ",
  backupStatus: "وضعیت بکاپ",
  patchStatus: "وضعیت Patch",
  restoreStatus: "وضعیت بازیابی",
};

function reportMetricEntries(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => REPORT_METRIC_LABELS[key] && (typeof item === "string" || typeof item === "number"))
    .map(([key, item]) => ({
      key,
      label: REPORT_METRIC_LABELS[key],
      value: typeof item === "number" && key.endsWith("Percent") ? `${item.toLocaleString("fa-IR")}٪` : String(item),
    }));
}

export default async function AccountParchinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerPage();
  const { id } = await params;
  let enrollment;
  try {
    enrollment = await getCustomerParchinEnrollment(user.id, id);
  } catch (error) {
    if (error instanceof WalletError && error.code === "not_found") notFound();
    throw error;
  }
  const contract = readParchinServiceSnapshot(enrollment.contractSnapshot);
  const upgradeOptions = await prisma.parchinPricingConfig.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: { level: true, title: true, priceRial: true },
  });
  const remaining = Math.max(
    0,
    enrollment.routineRequestLimit - enrollment.routineRequestsUsed,
  );
  const isActive = enrollment.status === "ACTIVE";
  const openTasks = enrollment.tasks.filter(
    (task) => task.status !== "COMPLETED" && task.status !== "CANCELED",
  );

  return (
    <>
      <PageHeader
        title={`${parchinLevelLabel(enrollment.level)} · ${enrollment.cloudInstance.name}`}
        description="قرارداد، سهمیه، برنامه عملیات و گزارش‌های منتشرشده"
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "پرچین‌های من", href: "/account/parchin" },
              { label: enrollment.cloudInstance.name },
            ]}
          />
        }
        actions={
          <Link href="/account/parchin" className="product-btn product-btn--quiet">
            بازگشت
          </Link>
        }
      />

      <div className="product-stat-grid">
        <div className="product-stat-card">
          <span>وضعیت قرارداد</span>
          <strong>{ENROLLMENT_STATUS[enrollment.status] ?? enrollment.status}</strong>
        </div>
        <div className="product-stat-card">
          <span>سهمیه روتین</span>
          <strong>
            {remaining.toLocaleString("fa-IR")} از {enrollment.routineRequestLimit.toLocaleString("fa-IR")}
          </strong>
        </div>
        <div className="product-stat-card">
          <span>پاسخ اولیه</span>
          <strong>{enrollment.firstResponseTarget}</strong>
        </div>
        <div className="product-stat-card">
          <span>نسخه قرارداد</span>
          <strong>{enrollment.contractVersion.toLocaleString("fa-IR")}</strong>
        </div>
      </div>

      <SectionCard title="سرویس و اقدام سریع">
        <p>
          سرور: <strong>{enrollment.cloudInstance.name}</strong>{" "}
          {enrollment.cloudInstance.ipv4 ? (
            <TechnicalValue>{enrollment.cloudInstance.ipv4}</TechnicalValue>
          ) : null}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isActive ? (
            <p className="parchin-notice">این قرارداد فعال نیست؛ درخواست عملیاتی تازه برای آن ثبت نمی‌شود.</p>
          ) : remaining > 0 ? (
            <Link
              href={`/account/support/requests/new?instanceId=${enrollment.cloudInstanceId}&kind=ROUTINE`}
              className="product-btn product-btn--primary"
            >
              درخواست روتین ({remaining.toLocaleString("fa-IR")} باقی‌مانده)
            </Link>
          ) : (
            <button className="product-btn product-btn--primary" disabled>
              سهمیه روتین این دوره مصرف شده است
            </button>
          )}
          {isActive && enrollment.level === "PARCHIN_STABLE" ? (
            <Link
              href={`/account/support/requests/new?instanceId=${enrollment.cloudInstanceId}&kind=P1_INCIDENT`}
              className="product-btn product-btn--danger"
            >
              اعلام رخداد P1
            </Link>
          ) : null}
        </div>
      </SectionCard>

      {contract ? (
        <SectionCard title={`${contract.title} · نسخه ${contract.version.toLocaleString("fa-IR")}`}>
          <p>{contract.description}</p>
          <p><strong>پنجره خدمت:</strong> {contract.supportWindow}</p>
          <ul className="parchin-contract-list">
            {contract.includedServices.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <details>
            <summary>تعریف‌ها و مرز خدمات</summary>
            <dl className="parchin-definition-list">
              {Object.entries(contract.definitions).map(([key, value]) => (
                <div key={key}><dt>{DEFINITION_LABELS[key] ?? key}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </details>
        </SectionCard>
      ) : null}

      <SectionCard title="برنامه عملیات">
        {openTasks.length === 0 ? (
          <p className="product-muted">کار برنامه‌ریزی‌شده بازی وجود ندارد.</p>
        ) : (
          <div className="parchin-customer-timeline">
            {openTasks.map((task) => (
              <article key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.description}</p>
                </div>
                <div>
                  <StatusBadge
                    label={TASK_STATUS[task.status] ?? task.status}
                    tone={task.status === "BLOCKED" ? "warning" : "info"}
                  />
                  <span>موعد {task.dueAt.toLocaleString("fa-IR")}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="گزارش‌های پرچین">
        {enrollment.reports.length === 0 ? (
          <p className="product-muted">اولین گزارش پس از پایان بازه عملیاتی منتشر می‌شود.</p>
        ) : (
          <div className="parchin-report-list">
            {enrollment.reports.map((report) => (
              <article key={report.id}>
                <header>
                  <span>{REPORT_TYPE[report.type] ?? report.type}</span>
                  <h3>{report.title}</h3>
                  <small>
                    {report.periodStart.toLocaleDateString("fa-IR")} تا {report.periodEnd.toLocaleDateString("fa-IR")}
                  </small>
                </header>
                <p>{report.summary}</p>
                {reportMetricEntries(report.metrics).length > 0 ? (
                  <dl className="parchin-report-metric-grid">
                    {reportMetricEntries(report.metrics).map((metric) => (
                      <div key={metric.key}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
                    ))}
                  </dl>
                ) : null}
                {Array.isArray(report.recommendations) && report.recommendations.length > 0 ? (
                  <ul>
                    {report.recommendations.filter((item): item is string => typeof item === "string").map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="ارتقای سطح برای دوره بعد">
        {!isActive ? (
          <p className="product-muted">ارتقا فقط برای قرارداد فعال قابل ثبت است.</p>
        ) : enrollment.requestedNextLevel ? (
          <p>
            درخواست ارتقا به <strong>{parchinLevelLabel(enrollment.requestedNextLevel)}</strong> ثبت شده و هنگام تمدید بررسی می‌شود.
          </p>
        ) : (
          <ParchinUpgradeRequest
            enrollmentId={enrollment.id}
            options={upgradeOptions
              .filter((item) => parchinLevelRank(item.level) > parchinLevelRank(enrollment.level))
              .map((item) => ({
                level: item.level,
                title: item.title,
                monthlyPriceTomanFa: formatTomanFa(item.priceRial),
              }))}
          />
        )}
      </SectionCard>
    </>
  );
}
