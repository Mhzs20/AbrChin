import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ParchinReportForm } from "@/components/admin/parchin-report-form";
import { ParchinTaskAction } from "@/components/admin/parchin-task-action";
import {
  Breadcrumb,
  DataTable,
  PageHeader,
  SectionCard,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { parchinLevelLabel } from "@/lib/parchin/catalog";
import { getAdminParchinEnrollment } from "@/lib/parchin/service";
import { readParchinServiceSnapshot } from "@/lib/parchin/service-contract";
import { WalletError } from "@/lib/wallet/errors";

export const metadata: Metadata = {
  title: "عملیات قرارداد پرچین | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  TODO: "انجام‌نشده",
  IN_PROGRESS: "در حال انجام",
  BLOCKED: "مسدود",
  COMPLETED: "تکمیل‌شده",
  CANCELED: "لغوشده",
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: "کم",
  NORMAL: "عادی",
  HIGH: "بالا",
  CRITICAL: "بحرانی",
};

const REQUEST_KIND_LABEL: Record<string, string> = {
  GENERAL: "عمومی",
  ROUTINE: "روتین پرچین",
  P1_INCIDENT: "رخداد P1",
};

const REQUEST_STATUS_LABEL: Record<string, string> = {
  OPEN: "باز",
  IN_PROGRESS: "در حال رسیدگی",
  RESOLVED: "حل‌شده",
  CLOSED: "بسته",
};

function dateInput(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export default async function AdminParchinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;
  const { id } = await params;
  let enrollment;
  try {
    enrollment = await getAdminParchinEnrollment(id);
  } catch (error) {
    if (error instanceof WalletError && error.code === "not_found") notFound();
    throw error;
  }
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", accountStatus: "ACTIVE" },
    orderBy: [{ displayName: "asc" }, { mobile: "asc" }],
    select: { id: true, displayName: true, mobile: true },
  });
  const assignees = admins.map((item) => ({
    id: item.id,
    label: item.displayName || item.mobile,
  }));
  const contract = readParchinServiceSnapshot(enrollment.contractSnapshot);
  const now = new Date();
  const activeTasks = enrollment.tasks.filter(
    (task) => task.status !== "COMPLETED" && task.status !== "CANCELED",
  );
  const taskRows = activeTasks.map((task) => ({
    id: task.id,
    cells: {
      task: (
        <span>
          <strong>{task.title}</strong><br />
          <small className="product-muted">{task.description}</small>
        </span>
      ),
      priority: PRIORITY_LABEL[task.priority] ?? task.priority,
      status: (
        <StatusBadge
          label={STATUS_LABEL[task.status] ?? task.status}
          tone={task.status === "BLOCKED" ? "danger" : task.status === "IN_PROGRESS" ? "warning" : "info"}
        />
      ),
      due: (
        <span className={task.dueAt.getTime() < now.getTime() ? "parchin-overdue" : ""}>
          {task.dueAt.toLocaleString("fa-IR")}
        </span>
      ),
      owner: task.assignedTo?.displayName || task.assignedTo?.mobile || "—",
      action: (
        <ParchinTaskAction
          taskId={task.id}
          currentStatus={task.status}
          currentAssigneeId={task.assignedToId}
          assignees={assignees}
        />
      ),
    },
  }));

  return (
    <>
      <PageHeader
        title={`${parchinLevelLabel(enrollment.level)} · ${enrollment.cloudInstance.name}`}
        description="اجرای تعهد، مسئول، موعد، شاهد، درخواست و گزارش مشتری"
        breadcrumb={
          <Breadcrumb items={[{ label: "عملیات پرچین", href: "/admin/parchin" }, { label: enrollment.cloudInstance.name }]} />
        }
        actions={
          <Link href="/admin/parchin" className="product-btn product-btn--quiet">بازگشت</Link>
        }
      />

      <SectionCard title="قرارداد و سرویس">
        <dl className="parchin-admin-summary">
          <div><dt>مشتری</dt><dd>{enrollment.user.displayName || "—"}<br /><TechnicalValue>{enrollment.user.mobile}</TechnicalValue></dd></div>
          <div><dt>سرور</dt><dd>{enrollment.cloudInstance.name}<br />{enrollment.cloudInstance.ipv4 ? <TechnicalValue>{enrollment.cloudInstance.ipv4}</TechnicalValue> : "—"}</dd></div>
          <div><dt>قرارداد</dt><dd>{contract?.title ?? parchinLevelLabel(enrollment.level)} · نسخه {enrollment.contractVersion.toLocaleString("fa-IR")}</dd></div>
          <div><dt>پاسخ اولیه</dt><dd>{enrollment.firstResponseTarget}</dd></div>
          <div><dt>سهمیه روتین</dt><dd>{enrollment.routineRequestsUsed.toLocaleString("fa-IR")} از {enrollment.routineRequestLimit.toLocaleString("fa-IR")}</dd></div>
          <div><dt>دوره</dt><dd>{enrollment.quotaPeriodStart.toLocaleDateString("fa-IR")} تا {enrollment.quotaPeriodEnd.toLocaleDateString("fa-IR")}</dd></div>
        </dl>
        {enrollment.requestedNextLevel ? (
          <p className="parchin-notice">درخواست ارتقا به {parchinLevelLabel(enrollment.requestedNextLevel)} برای دوره بعد ثبت شده است.</p>
        ) : null}
      </SectionCard>

      <SectionCard title={`صف کار (${activeTasks.length.toLocaleString("fa-IR")})`}>
        <div className="parchin-task-table">
          <DataTable
            columns={[
              { key: "task", header: "وظیفه" },
              { key: "priority", header: "اولویت" },
              { key: "status", header: "وضعیت" },
              { key: "due", header: "موعد" },
              { key: "owner", header: "مسئول" },
              { key: "action", header: "" },
            ]}
            rows={taskRows}
            emptyMessage="کار بازی برای این قرارداد وجود ندارد."
          />
        </div>
      </SectionCard>

      <SectionCard title="درخواست‌ها و رخدادها">
        {enrollment.supportRequests.length === 0 ? (
          <p className="product-muted">درخواستی ثبت نشده است.</p>
        ) : (
          <ul className="parchin-request-list">
            {enrollment.supportRequests.map((request) => (
              <li key={request.id}>
                <div>
                  <strong>{request.subject}</strong>
                  <span>{REQUEST_KIND_LABEL[request.kind] ?? request.kind} · {REQUEST_STATUS_LABEL[request.status] ?? request.status}</span>
                </div>
                <div>
                  {request.firstResponseDueAt ? <span>موعد پاسخ {request.firstResponseDueAt.toLocaleString("fa-IR")}</span> : null}
                  <Link href={`/admin/support/${request.id}`} className="product-btn product-btn--quiet">رسیدگی</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ParchinReportForm
        enrollmentId={enrollment.id}
        defaultPeriodStart={dateInput(enrollment.quotaPeriodStart)}
        defaultPeriodEnd={dateInput(now)}
      />

      <SectionCard title="تاریخچه گزارش‌ها">
        {enrollment.reports.length === 0 ? (
          <p className="product-muted">هنوز گزارشی ثبت نشده است.</p>
        ) : (
          <div className="parchin-report-list">
            {enrollment.reports.map((report) => (
              <article key={report.id}>
                <header><span>{report.status === "PUBLISHED" ? "منتشرشده" : "پیش‌نویس"}</span><h3>{report.title}</h3><small>{report.periodEnd.toLocaleDateString("fa-IR")}</small></header>
                <p>{report.summary}</p>
                <small>ثبت‌کننده: {report.createdBy.displayName || report.createdBy.mobile}</small>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );
}
