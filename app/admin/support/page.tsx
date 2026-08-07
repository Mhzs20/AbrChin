import type { Metadata } from "next";
import Link from "next/link";

import {
  DataTable,
  FilterBar,
  PageHeader,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
} from "@/lib/labels/customer";
import { listAdminSupportRequests } from "@/lib/support/service";
import {
  SupportRequestPriority,
  SupportRequestStatus,
} from "@prisma/client";

export const metadata: Metadata = {
  title: "پشتیبانی | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "RESOLVED") return "success";
  if (status === "IN_PROGRESS") return "warning";
  if (status === "OPEN") return "info";
  return "neutral";
}

function priorityTone(
  priority: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (priority === "URGENT") return "danger";
  if (priority === "HIGH") return "warning";
  return "neutral";
}

export default async function AdminSupportListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string }>;
}) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const { status: statusRaw, priority: priorityRaw } = await searchParams;
  const status =
    statusRaw &&
    Object.values(SupportRequestStatus).includes(
      statusRaw as SupportRequestStatus,
    )
      ? (statusRaw as SupportRequestStatus)
      : null;
  const priority =
    priorityRaw &&
    Object.values(SupportRequestPriority).includes(
      priorityRaw as SupportRequestPriority,
    )
      ? (priorityRaw as SupportRequestPriority)
      : null;

  const requests = await listAdminSupportRequests({ status, priority });

  const columns = [
    { key: "subject", header: "موضوع" },
    { key: "user", header: "مشتری" },
    { key: "category", header: "دسته" },
    { key: "status", header: "وضعیت" },
    { key: "priority", header: "اولویت" },
    { key: "createdAt", header: "زمان" },
    { key: "actions", header: "" },
  ];

  const rows = requests.map((item) => ({
    id: item.id,
    cells: {
      subject: item.subject,
      user: (
        <span>
          {item.user.displayName || "—"}
          <br />
          <TechnicalValue>{item.user.mobile}</TechnicalValue>
        </span>
      ),
      category: SUPPORT_CATEGORY_LABELS[item.category] ?? item.category,
      status: (
        <StatusBadge
          label={SUPPORT_STATUS_LABELS[item.status] ?? item.status}
          tone={statusTone(item.status)}
        />
      ),
      priority: (
        <StatusBadge
          label={SUPPORT_PRIORITY_LABELS[item.priority] ?? item.priority}
          tone={priorityTone(item.priority)}
        />
      ),
      createdAt: new Date(item.createdAt).toLocaleString("fa-IR"),
      actions: (
        <Link
          href={`/admin/support/${item.id}`}
          className="product-btn product-btn--quiet"
        >
          رسیدگی
        </Link>
      ),
    },
  }));

  function hrefFor(next: { status?: string | null; priority?: string | null }) {
    const params = new URLSearchParams();
    const nextStatus = next.status === undefined ? status : next.status;
    const nextPriority =
      next.priority === undefined ? priority : next.priority;
    if (nextStatus) params.set("status", nextStatus);
    if (nextPriority) params.set("priority", nextPriority);
    const qs = params.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  }

  return (
    <>
      <PageHeader
        title="پشتیبانی"
        description="درخواست‌های پشتیبانی مشتریان بر اساس وضعیت و اولویت"
      />

      <FilterBar>
        <Link
          href={hrefFor({ status: null })}
          className={`product-btn product-btn--quiet${status == null ? " is-active" : ""}`}
        >
          همه وضعیت‌ها
        </Link>
        {Object.values(SupportRequestStatus).map((value) => (
          <Link
            key={value}
            href={hrefFor({ status: value })}
            className={`product-btn product-btn--quiet${status === value ? " is-active" : ""}`}
          >
            {SUPPORT_STATUS_LABELS[value]}
          </Link>
        ))}
        <span style={{ width: 1, background: "var(--product-line)", alignSelf: "stretch" }} />
        <Link
          href={hrefFor({ priority: null })}
          className={`product-btn product-btn--quiet${priority == null ? " is-active" : ""}`}
        >
          همه اولویت‌ها
        </Link>
        {Object.values(SupportRequestPriority).map((value) => (
          <Link
            key={value}
            href={hrefFor({ priority: value })}
            className={`product-btn product-btn--quiet${priority === value ? " is-active" : ""}`}
          >
            {SUPPORT_PRIORITY_LABELS[value]}
          </Link>
        ))}
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        emptyMessage="درخواستی با این فیلتر پیدا نشد."
      />
    </>
  );
}
