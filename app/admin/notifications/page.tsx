import type { Metadata } from "next";

import { DataTable, PageHeader, StatusBadge } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "اعلان‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const statusLabel = { UNREAD: "خوانده‌نشده", READ: "خوانده‌شده", RESOLVED: "حل‌شده" } as const;

export default async function AdminNotificationsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const notifications = await prisma.adminNotification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { infrastructureOrder: true },
  });

  const columns = [
    { key: "type", header: "نوع" },
    { key: "title", header: "عنوان" },
    { key: "status", header: "وضعیت" },
    { key: "createdAt", header: "زمان" },
  ];

  const rows = notifications.map((item) => ({
    id: item.id,
    cells: {
      type: item.type,
      title: item.title,
      status: <StatusBadge label={statusLabel[item.status]} tone={item.status === "UNREAD" ? "warning" : "neutral"} />,
      createdAt: new Date(item.createdAt).toLocaleString("fa-IR"),
    },
  }));

  return (
    <>
      <PageHeader title="اعلان‌ها" description="اعلان‌های عملیاتی سیستم" />
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
