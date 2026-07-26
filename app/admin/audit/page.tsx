import type { Metadata } from "next";

import { DataTable, PageHeader, TechnicalValue } from "@/components/product";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "گزارش عملیات | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: true },
  });

  const columns = [
    { key: "action", header: "عملیات" },
    { key: "entity", header: "موجودیت" },
    { key: "actor", header: "مدیر" },
    { key: "createdAt", header: "زمان" },
  ];

  const rows = logs.map((log) => ({
    id: log.id,
    cells: {
      action: log.action,
      entity: <TechnicalValue>{log.entityType}:{log.entityId || "—"}</TechnicalValue>,
      actor: log.actor.mobile,
      createdAt: new Date(log.createdAt).toLocaleString("fa-IR"),
    },
  }));

  return (
    <>
      <PageHeader title="گزارش عملیات" description="Audit غیرقابل ویرایش" />
      <DataTable columns={columns} rows={rows} emptyMessage="هنوز رویدادی ثبت نشده است." />
    </>
  );
}
