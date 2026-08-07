import type { Metadata } from "next";
import Link from "next/link";

import {
  DataTable,
  EmptyState,
  PageHeader,
  ResponsiveRowList,
  SectionCard,
  StatusBadge,
} from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
} from "@/lib/labels/customer";
import { listCustomerSupportRequests } from "@/lib/support/service";

export const metadata: Metadata = {
  title: "پشتیبانی | حساب من | ابرچین",
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

export default async function AccountSupportPage() {
  const user = await requireCustomerPage();
  const requests = await listCustomerSupportRequests(user.id);

  const columns = [
    { key: "subject", header: "موضوع" },
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
          href={`/account/support/requests/${item.id}`}
          className="product-btn product-btn--quiet"
        >
          جزئیات
        </Link>
      ),
    },
  }));

  const mobileRows = requests.map((item) => ({
    id: item.id,
    title: item.subject,
    fields: [
      {
        label: "دسته",
        value: SUPPORT_CATEGORY_LABELS[item.category] ?? item.category,
      },
      {
        label: "وضعیت",
        value: (
          <StatusBadge
            label={SUPPORT_STATUS_LABELS[item.status] ?? item.status}
            tone={statusTone(item.status)}
          />
        ),
      },
      {
        label: "اولویت",
        value: (
          <StatusBadge
            label={SUPPORT_PRIORITY_LABELS[item.priority] ?? item.priority}
            tone={priorityTone(item.priority)}
          />
        ),
      },
      {
        label: "زمان",
        value: new Date(item.createdAt).toLocaleString("fa-IR"),
      },
    ],
    actions: (
      <Link
        href={`/account/support/requests/${item.id}`}
        className="product-btn product-btn--quiet"
      >
        جزئیات
      </Link>
    ),
  }));

  return (
    <>
      <PageHeader
        title="پشتیبانی"
        description="درخواست‌های پشتیبانی و راه‌های ارتباطی"
        actions={
          <Link
            href="/account/support/requests/new"
            className="product-btn product-btn--primary"
          >
            درخواست جدید
          </Link>
        }
      />

      <SectionCard title="درخواست‌های من">
        {requests.length === 0 ? (
          <EmptyState
            title="هنوز درخواستی ثبت نشده"
            description="برای موضوع تحویل، دسترسی، پرداخت یا تغییر سرویس درخواست بساز."
            action={
              <Link
                href="/account/support/requests/new"
                className="product-btn product-btn--primary"
              >
                ثبت درخواست
              </Link>
            }
          />
        ) : (
          <>
            <DataTable columns={columns} rows={rows} />
            <ResponsiveRowList rows={mobileRows} />
          </>
        )}
      </SectionCard>

      <SectionCard title="ارتباط مستقیم">
        <ul style={{ margin: 0, paddingRight: 18, display: "grid", gap: 8 }}>
          <li>
            ایمیل:{" "}
            <a className="product-tech" href="mailto:support@abrchin.ir" dir="ltr">
              support@abrchin.ir
            </a>
          </li>
          <li>ساعات پاسخ‌گویی: شنبه تا پنج‌شنبه، ۹ تا ۱۸</li>
        </ul>
      </SectionCard>

      <SectionCard title="راهنما">
        <p>برای راهنمای شروع و انتخاب سرویس مناسب:</p>
        <Link href="/help" className="product-btn product-btn--quiet">
          مراجعه به راهنمای ابرچین
        </Link>
      </SectionCard>
    </>
  );
}
