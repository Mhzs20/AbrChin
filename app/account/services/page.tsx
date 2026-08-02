import type { Metadata } from "next";
import Link from "next/link";

import {
  DataTable,
  PageHeader,
  ResponsiveRowList,
  StatusBadge,
  TechnicalValue,
  Timeline,
} from "@/components/product";
import { getUserServices } from "@/lib/account/queries";
import { requireCustomerPage } from "@/lib/auth/guards";
import {
  cloudInstanceStatusLabel,
  deliveryModeLabel,
  getInfrastructureStage,
} from "@/lib/labels/infrastructure";

export const metadata: Metadata = {
  title: "سرویس‌های من | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountServicesPage() {
  const user = await requireCustomerPage();

  const services = await getUserServices(user.id);
  const columns = [
    { key: "name", header: "نام" },
    { key: "ip", header: "IP" },
    { key: "plan", header: "پلن" },
    { key: "region", header: "Region" },
    { key: "size", header: "Size" },
    { key: "image", header: "Image" },
    { key: "mode", header: "نوع" },
    { key: "status", header: "وضعیت" },
    { key: "createdAt", header: "ایجاد" },
    { key: "actions", header: "" },
  ];

  const rows = services.map((service) => ({
    id: service.id,
    cells: {
      name: service.name,
      ip: service.ipv4 ? <TechnicalValue>{service.ipv4}</TechnicalValue> : "—",
      plan: service.infrastructureOrder.plan.title,
      region: <TechnicalValue>{service.region}</TechnicalValue>,
      size: <TechnicalValue>{service.size}</TechnicalValue>,
      image: <TechnicalValue>{service.image}</TechnicalValue>,
      mode: deliveryModeLabel[service.deliveryMode],
      status: <StatusBadge label={cloudInstanceStatusLabel[service.status]} tone={service.status === "ACTIVE" ? "success" : "warning"} />,
      createdAt: new Date(service.createdAt).toLocaleString("fa-IR"),
      actions: (
        <Link
          className="product-btn product-btn--quiet"
          href={`/account/orders/${service.infrastructureOrder.serviceOrder.id}`}
        >
          مدیریت و تمدید
        </Link>
      ),
    },
  }));

  const mobileRows = services.map((service) => ({
    id: service.id,
    title: service.name,
    fields: [
      { label: "IP", value: service.ipv4 ? <TechnicalValue>{service.ipv4}</TechnicalValue> : "—" },
      { label: "پلن", value: service.infrastructureOrder.plan.title },
      { label: "وضعیت", value: cloudInstanceStatusLabel[service.status] },
      { label: "مرحله", value: getInfrastructureStage(service.infrastructureOrder.status) },
    ],
    actions: (
      <Link
        className="product-btn product-btn--quiet"
        href={`/account/orders/${service.infrastructureOrder.serviceOrder.id}`}
      >
        مدیریت و تمدید
      </Link>
    ),
  }));

  return (
    <>
      <PageHeader title="سرویس‌های من" description="سرورها و وضعیت آماده‌سازی" />
      <DataTable columns={columns} rows={rows} emptyMessage="هنوز سرویسی ندارید." />
      <ResponsiveRowList rows={mobileRows} />
      {services[0] ? (
        <section className="product-section" style={{ marginTop: 24 }}>
          <h2 className="product-section-title">نمونه زمان‌بندی آماده‌سازی</h2>
          <Timeline
            items={[
              { id: "paid", title: "پرداخت", done: true },
              {
                id: "funding",
                title: "تأمین زیرساخت",
                done: services[0].infrastructureOrder.status !== "WAITING_ADMIN_FUNDING",
              },
              {
                id: "queue",
                title: "صف آماده‌سازی",
                done: !["WAITING_ADMIN_FUNDING", "QUEUED"].includes(services[0].infrastructureOrder.status),
              },
              { id: "active", title: "فعال", done: services[0].status === "ACTIVE" },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
