import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminUserDetailPanel } from "@/components/admin/admin-user-detail-panel";
import {
  MoneyDisplay,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/product";
import {
  getAdminManagedUser,
  listAdminManagedUsers,
  listUserSiteActivity,
} from "@/lib/admin/user-admin";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "جزئیات کاربر | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const { id } = await params;
  const [user, activity, allUsers] = await Promise.all([
    getAdminManagedUser(id),
    listUserSiteActivity(id),
    listAdminManagedUsers({ take: 500 }),
  ]);
  if (!user || !activity) notFound();

  return (
    <>
      <PageHeader
        title={user.displayName || user.mobile}
        description={`مدیریت کاربر ${user.mobile}`}
        actions={
          <Link href="/admin/users" className="product-btn product-btn--quiet">
            بازگشت به فهرست
          </Link>
        }
      />

      <SectionCard title="اطلاعات کاربر">
        <p>
          موبایل: <span className="product-tech">{user.mobile}</span>
        </p>
        <p>
          نقش:{" "}
          <StatusBadge
            label={user.role === "ADMIN" ? "مدیر" : "مشتری"}
            tone={user.role === "ADMIN" ? "info" : "neutral"}
          />
        </p>
        <p>
          وضعیت:{" "}
          <StatusBadge
            label={user.accountStatus === "BLOCKED" ? "مسدود" : "فعال"}
            tone={user.accountStatus === "BLOCKED" ? "danger" : "success"}
          />
        </p>
        {user.blockedReason ? <p>دلیل مسدودی: {user.blockedReason}</p> : null}
        <p>
          موجودی:{" "}
          {user.wallet ? (
            <MoneyDisplay amount={formatTomanFa(user.wallet.availableBalance)} />
          ) : (
            "—"
          )}
        </p>
        <p>
          سفارش‌ها: {user._count.orders.toLocaleString("fa-IR")} · سرورها:{" "}
          {user._count.cloudInstances.toLocaleString("fa-IR")}
        </p>
      </SectionCard>

      <AdminUserDetailPanel
        userId={user.id}
        mobile={user.mobile}
        initialDisplayName={user.displayName}
        role={user.role}
        accountStatus={user.accountStatus}
        instances={user.cloudInstances.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          providerInstanceId: row.providerInstanceId,
          region: row.region,
          ipv4: row.ipv4,
        }))}
        activity={activity}
        otherUsers={allUsers
          .filter((row) => row.id !== user.id)
          .map((row) => ({
            id: row.id,
            mobile: row.mobile,
            displayName: row.displayName,
          }))}
      />
    </>
  );
}
