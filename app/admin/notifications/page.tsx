import type { Metadata } from "next";

import { DataTable, PageHeader, StatusBadge } from "@/components/product";
import { MarkAllNotificationsRead } from "@/components/admin/notifications-actions";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "اعلان‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const statusLabel = { UNREAD: "خوانده‌نشده", READ: "خوانده‌شده", RESOLVED: "حل‌شده" } as const;

/** Reader of this page is the Founder — types read in Persian, never raw enums. */
const typeLabel: Record<string, string> = {
  ORDER_WAITING_PROVIDER_FUNDING: "سفارش در انتظار تأمین Provider",
  ACTIVATION_WAITING_APPROVAL: "فعال‌سازی در انتظار تأیید",
  RESOURCE_CHANGE_WAITING_APPROVAL: "تغییر منابع در انتظار تأیید",
  WALLET_PAYMENT_REVIEW: "نیازمند بررسی پرداخت کیف پول",
  WALLET_CREDIT_RECONCILIATION: "تطبیق اعتبار کیف پول",
  CONTROLLED_REFUND_REVIEW: "بررسی بازپرداخت کنترل‌شده",
  LOW_BALANCE: "موجودی کم مشتری",
  OUTSTANDING_INVOICE: "صورتحساب پرداخت‌نشده",
  SUSPENSION_REVIEW: "بررسی تعلیق سرویس",
  PROVIDER_BILLING_RECONCILIATION: "تطبیق Billing تأمین‌کننده",
  CONNECTION_CHECK_FAILED: "شکست بررسی اتصال",
  PROVIDER_BALANCE_BLOCKED: "انسداد اعتبار نزد تأمین‌کننده",
  PROVISIONING_FAILED: "شکست ساخت سرور",
  NEEDS_RECONCILIATION: "نیازمند تطبیق",
  INSTANCE_ACTIVE: "سرور فعال شد",
  PAYMENT_FAILED: "شکست پرداخت",
  PROVIDER_UNAVAILABLE: "قطعی ارتباط با تأمین‌کننده",
  RENEWAL_PAID: "تمدید پرداخت شد",
  RENEWAL_DUE: "سررسید تمدید",
  STOREFRONT_ASSORTMENT_LOW: "کمبود ظرفیت چینش فروشگاه",
};

export default async function AdminNotificationsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const [notifications, unreadCount] = await Promise.all([
    prisma.adminNotification.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.adminNotification.count({ where: { status: "UNREAD" } }),
  ]);

  // Identical repeats collapse into one row with a count — a flapping provider
  // must not push real alerts below the fold.
  type Group = {
    id: string;
    type: string;
    title: string;
    status: keyof typeof statusLabel;
    count: number;
    lastAt: Date;
  };
  const groups = new Map<string, Group>();
  for (const item of notifications) {
    const key = `${item.type}|${item.title}|${item.status}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (item.createdAt > existing.lastAt) existing.lastAt = item.createdAt;
    } else {
      groups.set(key, {
        id: item.id,
        type: item.type,
        title: item.title,
        status: item.status,
        count: 1,
        lastAt: item.createdAt,
      });
    }
  }

  const columns = [
    { key: "type", header: "نوع" },
    { key: "title", header: "عنوان" },
    { key: "count", header: "تکرار" },
    { key: "status", header: "وضعیت" },
    { key: "lastAt", header: "آخرین رخداد" },
  ];

  const rows = [...groups.values()]
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
    .map((group) => ({
      id: group.id,
      cells: {
        type: typeLabel[group.type] ?? group.type,
        title: group.title,
        count:
          group.count > 1 ? `${group.count.toLocaleString("fa-IR")} بار` : "—",
        status: (
          <StatusBadge
            label={statusLabel[group.status]}
            tone={group.status === "UNREAD" ? "warning" : "neutral"}
          />
        ),
        lastAt: group.lastAt.toLocaleString("fa-IR"),
      },
    }));

  return (
    <>
      <PageHeader title="اعلان‌ها" description="اعلان‌های عملیاتی سیستم — تکرارهای یکسان در یک ردیف جمع شده‌اند" />
      <MarkAllNotificationsRead unread={unreadCount} />
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
