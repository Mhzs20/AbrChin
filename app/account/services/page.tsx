import type { Metadata } from "next";
import Link from "next/link";

import { ServiceChangeRequestButtons } from "@/components/account/service-change-request-buttons";
import {
  DataTable,
  PageHeader,
  ResponsiveRowList,
  StatusBadge,
  TechnicalValue,
  Timeline,
} from "@/components/product";
import { getUserAbrchinServers } from "@/lib/account/queries";
import { requireCustomerPage } from "@/lib/auth/guards";
import {
  cloudInstanceStatusLabel,
  deliveryModeLabel,
  getInfrastructureStage,
} from "@/lib/labels/infrastructure";

export const metadata: Metadata = {
  title: "ابرچین‌های من | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountServicesPage() {
  const user = await requireCustomerPage();
  const { instances, building } = await getUserAbrchinServers(user.id);
  const services = [
    ...building.map((item) => ({
      kind: "building" as const,
      id: item.id,
      name: item.name,
      ipv4: item.ipv4,
      planTitle: item.infrastructureOrder.plan.title,
      region: item.region,
      size: item.size,
      image: item.image,
      deliveryMode: item.deliveryMode,
      statusLabel: "در حال ساخت",
      statusTone: "warning" as const,
      createdAt: item.createdAt,
      orderId: item.infrastructureOrder.serviceOrder.id,
      instanceId: null as string | null,
      infraStatus: item.infrastructureOrder.status,
      canRequestChange: false,
    })),
    ...instances.map((service) => ({
      kind: "instance" as const,
      id: service.id,
      name: service.name,
      ipv4: service.ipv4,
      planTitle: service.infrastructureOrder.plan.title,
      region: service.region,
      size: service.size,
      image: service.image,
      deliveryMode: service.deliveryMode,
      statusLabel: cloudInstanceStatusLabel[service.status],
      statusTone:
        service.status === "ACTIVE" ? ("success" as const) : ("warning" as const),
      createdAt: service.createdAt,
      orderId: service.infrastructureOrder.serviceOrder.id,
      instanceId: service.id,
      infraStatus: service.infrastructureOrder.status,
      canRequestChange: service.status === "ACTIVE",
    })),
  ];

  const columns = [
    { key: "name", header: "نام" },
    { key: "ip", header: "IP" },
    { key: "plan", header: "پلن" },
    { key: "os", header: "سیستم‌عامل" },
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
      plan: service.planTitle,
      os: <TechnicalValue>{service.image}</TechnicalValue>,
      mode: deliveryModeLabel[service.deliveryMode],
      status: <StatusBadge label={service.statusLabel} tone={service.statusTone} />,
      createdAt: new Date(service.createdAt).toLocaleString("fa-IR"),
      actions: (
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            className="product-btn product-btn--quiet"
            href={`/account/orders/${service.orderId}`}
          >
            جزئیات
          </Link>
          {service.canRequestChange && service.instanceId ? (
            <ServiceChangeRequestButtons instanceId={service.instanceId} />
          ) : null}
        </span>
      ),
    },
  }));

  const mobileRows = services.map((service) => ({
    id: service.id,
    title: service.name,
    fields: [
      { label: "IP", value: service.ipv4 ? <TechnicalValue>{service.ipv4}</TechnicalValue> : "—" },
      { label: "پلن", value: service.planTitle },
      { label: "وضعیت", value: service.statusLabel },
      { label: "مرحله", value: getInfrastructureStage(service.infraStatus) },
    ],
    actions: (
      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link
          className="product-btn product-btn--quiet"
          href={`/account/orders/${service.orderId}`}
        >
          جزئیات
        </Link>
        {service.canRequestChange && service.instanceId ? (
          <ServiceChangeRequestButtons instanceId={service.instanceId} />
        ) : null}
      </span>
    ),
  }));

  const first = services[0];

  return (
    <>
      <PageHeader
        title="ابرچین‌های من"
        description="سرورهای خریداری‌شده؛ پس از پرداخت تا تکمیل ساخت، وضعیت «در حال ساخت» است."
      />
      <DataTable
        columns={columns}
        rows={rows}
        emptyMessage="هنوز ابرچینی ندارید."
      />
      <ResponsiveRowList rows={mobileRows} />
      {first ? (
        <section className="product-section" style={{ marginTop: 24 }}>
          <h2 className="product-section-title">نمونه زمان‌بندی ساخت</h2>
          <Timeline
            items={[
              {
                id: "paid",
                title: "پرداخت و ثبت درخواست",
                done: true,
              },
              {
                id: "building",
                title: "در حال ساخت سرور",
                done: first.kind === "instance",
              },
              {
                id: "active",
                title: "فعال و قابل مشاهده",
                done: first.statusTone === "success",
              },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
