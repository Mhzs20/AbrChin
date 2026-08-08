import type { Metadata } from "next";
import Link from "next/link";

import { ServiceChangeRequestButtons } from "@/components/account/service-change-request-buttons";
import {
  PageHeader,
  StatusBadge,
  TechnicalValue,
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

function serviceNextAction(service: {
  kind: "building" | "instance";
  statusTone: "success" | "warning";
}) {
  if (service.kind === "building") {
    return {
      title: "ساخت و کنترل سلامت با ابرچین است",
      description: "برای دیدن تغییر وضعیت نیازی به اقدام شما نیست؛ همین صفحه به‌روز می‌شود.",
    };
  }
  if (service.statusTone === "success") {
    return {
      title: "سرور آماده استفاده است",
      description: "اطلاعات دسترسی امن و تمدید را در جزئیات سفارش مدیریت کن.",
    };
  }
  return {
    title: "وضعیت سرویس در حال بررسی است",
    description: "جزئیات سفارش آخرین رویداد و مسیر پیگیری را نشان می‌دهد.",
  };
}

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
      vcpu: null as number | null,
      ramGb: null as number | null,
      diskGb: null as number | null,
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
      vcpu: service.infrastructureOrder.plan.vcpu ?? null,
      ramGb: service.infrastructureOrder.plan.ramGb ?? null,
      diskGb: service.infrastructureOrder.plan.storageGb ?? null,
    })),
  ];

  return (
    <>
      <PageHeader
        title="سرورهای من"
        description="وضعیت واقعی هر سرور، اقدام بعدی و دسترسی امن را یک‌جا ببین."
        actions={
          <Link className="product-btn product-btn--primary" href="/cloud-servers">
            خرید سرور جدید
          </Link>
        }
      />
      {services.length === 0 ? (
        <section className="product-empty-state">
          <div>
            <h2>هنوز سروری نداری</h2>
            <p>از فهرست قابل‌خرید انتخاب کن یا با قطب‌نما نیازت را به پیشنهاد تبدیل کن.</p>
          </div>
          <div className="product-empty-state__actions">
            <Link className="product-btn product-btn--primary" href="/cloud-servers">
              انتخاب سرور
            </Link>
            <Link className="product-btn product-btn--quiet" href="/compass">
              گفت‌وگو با قطب‌نما
            </Link>
          </div>
        </section>
      ) : (
        <div className="account-service-grid">
          {services.map((service) => {
            const nextAction = serviceNextAction(service);
            return (
              <article className="account-service-card" key={`${service.kind}-${service.id}`}>
                <header className="account-service-card__header">
                  <div>
                    <span>{service.planTitle}</span>
                    <h2>{service.name}</h2>
                  </div>
                  <StatusBadge label={service.statusLabel} tone={service.statusTone} />
                </header>

                <div className="account-service-card__resources">
                  <div>
                    <small>نشانی سرور</small>
                    <strong>
                      {service.ipv4 ? <TechnicalValue>{service.ipv4}</TechnicalValue> : "پس از تحویل نمایش داده می‌شود"}
                    </strong>
                  </div>
                  <div>
                    <small>سیستم‌عامل</small>
                    <strong dir="ltr">{service.image}</strong>
                  </div>
                  <div>
                    <small>موقعیت و نوع تحویل</small>
                    <strong>{service.region} · {deliveryModeLabel[service.deliveryMode]}</strong>
                  </div>
                </div>

                <div className="account-service-card__next">
                  <small>الان چه می‌شود؟</small>
                  <strong>{nextAction.title}</strong>
                  <p>{nextAction.description}</p>
                  <span>{getInfrastructureStage(service.infraStatus)}</span>
                </div>

                <footer className="account-service-card__actions">
                  <Link
                    className="product-btn product-btn--primary"
                    href={`/account/orders/${service.orderId}`}
                  >
                    مشاهده وضعیت و دسترسی
                  </Link>
                  {service.canRequestChange && service.instanceId ? (
                    <ServiceChangeRequestButtons
                      instanceId={service.instanceId}
                      orderId={service.orderId}
                      serverName={service.name}
                      currentResources={{
                        vcpu: service.vcpu,
                        ramGb: service.ramGb,
                        diskGb: service.diskGb,
                      }}
                    />
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
