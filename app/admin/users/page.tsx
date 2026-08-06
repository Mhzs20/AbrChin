import type { Metadata } from "next";

import {
  AdminUserActionsLink,
  AdminUsersCreateForm,
} from "@/components/admin/admin-users-panel";
import {
  DataTable,
  MoneyDisplay,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/product";
import { listAdminManagedUsers } from "@/lib/admin/user-admin";
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

  const users = await listAdminManagedUsers();
  const columns = [
    { key: "mobile", header: "موبایل" },
    { key: "name", header: "نام" },
    { key: "role", header: "نقش" },
    { key: "status", header: "وضعیت" },
    { key: "orders", header: "سفارش" },
    { key: "services", header: "سرویس" },
    { key: "balance", header: "موجودی" },
    { key: "joined", header: "عضویت" },
    { key: "actions", header: "عملیات" },
  ];

  const rows = users.map((user) => ({
    id: user.id,
    cells: {
      mobile: <span className="product-tech">{user.mobile}</span>,
      name: user.displayName || "—",
      role: (
        <StatusBadge
          label={user.role === "ADMIN" ? "مدیر" : "مشتری"}
          tone={user.role === "ADMIN" ? "info" : "neutral"}
        />
      ),
      status: (
        <StatusBadge
          label={user.accountStatus === "BLOCKED" ? "مسدود" : "فعال"}
          tone={user.accountStatus === "BLOCKED" ? "danger" : "success"}
        />
      ),
      orders: user._count.orders.toLocaleString("fa-IR"),
      services: user._count.cloudInstances.toLocaleString("fa-IR"),
      balance: user.wallet ? (
        <MoneyDisplay amount={formatTomanFa(user.wallet.availableBalance)} />
      ) : (
        "—"
      ),
      joined: new Date(user.createdAt).toLocaleDateString("fa-IR"),
      actions: (
        <AdminUserActionsLink
          user={{
            id: user.id,
            mobile: user.mobile,
            displayName: user.displayName,
            role: user.role,
            accountStatus: user.accountStatus,
            ordersCount: user._count.orders,
            serversCount: user._count.cloudInstances,
            balanceTomanFa: user.wallet
              ? formatTomanFa(user.wallet.availableBalance)
              : "۰",
            createdAt: user.createdAt.toISOString(),
          }}
        />
      ),
    },
  }));

  return (
    <>
      <PageHeader
        title="کاربران"
        description="ساخت، مشاهده، ویرایش، اکشن‌ها، انتقال/وصل سرور، مسدودسازی و حذف کامل با Audit."
      />
      <SectionCard title="ساخت کاربر">
        <AdminUsersCreateForm />
      </SectionCard>
      <SectionCard title="فهرست کاربران">
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="هنوز کاربری ثبت نشده است."
        />
      </SectionCard>
    </>
  );
}
