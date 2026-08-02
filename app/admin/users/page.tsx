import type { Metadata } from "next";

import { DataTable, MoneyDisplay, PageHeader, StatusBadge } from "@/components/product";
import { listAdminUsers } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "کاربران | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const users = await listAdminUsers();
  const columns = [
    { key: "mobile", header: "موبایل" },
    { key: "name", header: "نام" },
    { key: "role", header: "نقش" },
    { key: "orders", header: "سفارش" },
    { key: "services", header: "سرویس" },
    { key: "balance", header: "موجودی" },
    { key: "joined", header: "عضویت" },
  ];

  const rows = users.map((user) => ({
    id: user.id,
    cells: {
      mobile: <span className="product-tech">{user.mobile}</span>,
      name: user.displayName || "—",
      role: <StatusBadge label={user.role === "ADMIN" ? "مدیر" : "مشتری"} tone={user.role === "ADMIN" ? "info" : "neutral"} />,
      orders: user._count.orders.toLocaleString("fa-IR"),
      services: user._count.cloudInstances.toLocaleString("fa-IR"),
      balance: user.wallet ? <MoneyDisplay amount={formatTomanFa(user.wallet.availableBalance)} /> : "—",
      joined: new Date(user.createdAt).toLocaleDateString("fa-IR"),
    },
  }));

  return (
    <>
      <PageHeader title="کاربران" description="مشاهده فقط‌خواندنی کاربران؛ تغییر نقش در این نسخه پشتیبانی نمی‌شود." />
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
