import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, PageHeader, StatusBadge, TechnicalValue } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { cloudInstanceStatusLabel, deliveryModeLabel } from "@/lib/labels/infrastructure";

export const metadata: Metadata = {
  title: "سرورها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminInstancesPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const instances = await prisma.cloudInstance.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: true,
      infrastructureOrder: { include: { plan: true, serviceOrder: true } },
    },
  });

  const columns = [
    { key: "customer", header: "مشتری" },
    { key: "plan", header: "پلن" },
    { key: "providerId", header: "Provider ID" },
    { key: "ip", header: "IP" },
    { key: "region", header: "Region" },
    { key: "status", header: "وضعیت" },
    { key: "actions", header: "" },
  ];

  const rows = instances.map((instance) => ({
    id: instance.id,
    cells: {
      customer: instance.user.mobile,
      plan: instance.infrastructureOrder.plan.title,
      providerId: <TechnicalValue>{instance.providerInstanceId}</TechnicalValue>,
      ip: instance.ipv4 ? <TechnicalValue>{instance.ipv4}</TechnicalValue> : "—",
      region: <TechnicalValue>{instance.region}</TechnicalValue>,
      status: <StatusBadge label={cloudInstanceStatusLabel[instance.status]} tone={instance.status === "ACTIVE" ? "success" : "warning"} />,
      actions: (
        <Link href={`/admin/instances/${instance.id}`} className="product-btn product-btn--quiet">
          جزئیات
        </Link>
      ),
    },
  }));

  return (
    <>
      <PageHeader title="سرورها" description="CloudInstanceهای فعال و در حال آماده‌سازی" />
      <DataTable columns={columns} rows={rows} emptyMessage="سروری ثبت نشده است." />
      <p style={{ marginTop: 12, color: "var(--product-muted)" }}>
        نوع تحویل نمونه: {instances[0] ? deliveryModeLabel[instances[0].deliveryMode] : "—"}
      </p>
    </>
  );
}
