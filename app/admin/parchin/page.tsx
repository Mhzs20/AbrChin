import {
  ParchinEnrollmentStatus,
  ParchinLevel,
} from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";

import {
  DataTable,
  PageHeader,
  ResponsiveRowList,
  SectionCard,
  StatCard,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { parchinLevelLabel } from "@/lib/parchin/catalog";
import {
  getAdminParchinOperations,
  listAdminParchinEnrollments,
} from "@/lib/parchin/service";

export const metadata: Metadata = {
  title: "مرکز عملیات پرچین | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ENROLLMENT_STATUS_LABELS: Record<ParchinEnrollmentStatus, string> = {
  ACTIVE: "فعال",
  PAST_DUE: "سررسیدشده",
  SUSPENDED: "تعلیق‌شده",
  CANCELED: "لغوشده",
  ENDED: "پایان‌یافته",
};

export default async function AdminParchinPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; status?: string; q?: string }>;
}) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;
  const raw = await searchParams;
  const level = Object.values(ParchinLevel).includes(raw.level as ParchinLevel)
    ? (raw.level as ParchinLevel)
    : null;
  const status = Object.values(ParchinEnrollmentStatus).includes(
    raw.status as ParchinEnrollmentStatus,
  )
    ? (raw.status as ParchinEnrollmentStatus)
    : null;
  const [operations, enrollments] = await Promise.all([
    getAdminParchinOperations(),
    listAdminParchinEnrollments({ level, status, query: raw.q }),
  ]);

  const rows = enrollments.map((enrollment) => ({
    id: enrollment.id,
    cells: {
      server: (
        <span>
          <strong>{enrollment.cloudInstance.name}</strong>
          <br />
          {enrollment.cloudInstance.ipv4 ? (
            <TechnicalValue>{enrollment.cloudInstance.ipv4}</TechnicalValue>
          ) : (
            "—"
          )}
        </span>
      ),
      customer: (
        <span>
          {enrollment.user.displayName || "—"}
          <br />
          <TechnicalValue>{enrollment.user.mobile}</TechnicalValue>
        </span>
      ),
      level: parchinLevelLabel(enrollment.level),
      status: (
        <StatusBadge
          label={ENROLLMENT_STATUS_LABELS[enrollment.status]}
          tone={enrollment.status === "ACTIVE" ? "success" : "warning"}
        />
      ),
      tasks: enrollment._count.tasks.toLocaleString("fa-IR"),
      support: enrollment._count.supportRequests.toLocaleString("fa-IR"),
      quota: `${enrollment.routineRequestsUsed.toLocaleString("fa-IR")} / ${enrollment.routineRequestLimit.toLocaleString("fa-IR")}`,
      action: (
        <Link
          href={`/admin/parchin/${enrollment.id}`}
          className="product-btn product-btn--primary"
        >
          عملیات
        </Link>
      ),
    },
  }));
  const mobileRows = enrollments.map((enrollment) => ({
    id: enrollment.id,
    title: `${enrollment.cloudInstance.name} · ${parchinLevelLabel(enrollment.level)}`,
    fields: [
      { label: "مشتری", value: enrollment.user.displayName || enrollment.user.mobile },
      { label: "وضعیت", value: ENROLLMENT_STATUS_LABELS[enrollment.status] },
      { label: "کار باز", value: enrollment._count.tasks.toLocaleString("fa-IR") },
      { label: "درخواست باز", value: enrollment._count.supportRequests.toLocaleString("fa-IR") },
      { label: "سهمیه مصرف", value: `${enrollment.routineRequestsUsed.toLocaleString("fa-IR")} / ${enrollment.routineRequestLimit.toLocaleString("fa-IR")}` },
    ],
    actions: <Link href={`/admin/parchin/${enrollment.id}`} className="product-btn product-btn--primary">عملیات</Link>,
  }));

  return (
    <>
      <PageHeader
        title="مرکز عملیات پرچین"
        description="صف کار، SLA، رخداد P1، گزارش و مسئول هر قرارداد"
        actions={
          <Link href="/admin/support" className="product-btn product-btn--quiet">
            صف پشتیبانی
          </Link>
        }
      />
      <div className="product-stat-grid">
        <StatCard label="قرارداد فعال" value={operations.activeContracts.toLocaleString("fa-IR")} />
        <StatCard label="وظیفه عقب‌افتاده" value={operations.overdueTasks.toLocaleString("fa-IR")} />
        <StatCard label="موعد تا ۴ ساعت" value={operations.dueSoonTasks.toLocaleString("fa-IR")} />
        <StatCard label="رخداد P1 باز" value={operations.p1Requests.toLocaleString("fa-IR")} />
        <StatCard label="عبور از SLA پاسخ" value={operations.slaBreaches.toLocaleString("fa-IR")} />
      </div>

      <SectionCard title="فیلتر قراردادها">
        <form method="get" className="parchin-admin-filters">
          <label>
            <span>سطح</span>
            <select name="level" defaultValue={level ?? ""}>
              <option value="">همه سطح‌ها</option>
              {Object.values(ParchinLevel).map((value) => (
                <option key={value} value={value}>{parchinLevelLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>وضعیت</span>
            <select name="status" defaultValue={status ?? ""}>
              <option value="">همه وضعیت‌ها</option>
              {Object.values(ParchinEnrollmentStatus).map((value) => (
                <option key={value} value={value}>{ENROLLMENT_STATUS_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>مشتری، IP یا نام سرور</span>
            <input name="q" defaultValue={raw.q ?? ""} />
          </label>
          <button className="product-btn product-btn--primary">اعمال فیلتر</button>
          <Link href="/admin/parchin" className="product-btn product-btn--quiet">پاک‌کردن</Link>
        </form>
      </SectionCard>

      <SectionCard title={`قراردادها (${enrollments.length.toLocaleString("fa-IR")})`}>
        <DataTable
          columns={[
            { key: "server", header: "سرور" },
            { key: "customer", header: "مشتری" },
            { key: "level", header: "سطح" },
            { key: "status", header: "وضعیت" },
            { key: "tasks", header: "کار باز" },
            { key: "support", header: "درخواست باز" },
            { key: "quota", header: "سهمیه مصرف" },
            { key: "action", header: "" },
          ]}
          rows={rows}
          emptyMessage="قراردادی با این فیلتر پیدا نشد."
        />
        {mobileRows.length > 0 ? <ResponsiveRowList rows={mobileRows} /> : null}
      </SectionCard>
    </>
  );
}
