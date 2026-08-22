import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MoneyDisplay,
  PageHeader,
  SectionCard,
  StatusBadge,
  Timeline,
} from "@/components/product";
import { CredentialRevealPanel } from "@/components/account/credential-reveal-panel";
import { OrderStatusRefresh } from "@/components/account/order-status-refresh";
import { ServiceCancelPanel } from "@/components/account/service-cancel-panel";
import { SubscriptionPanel } from "@/components/account/subscription-panel";
import { requireCustomerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { accessMethodLabel, customerBillingModelLabel, effectiveTermDiscountLabel, specGbFa, specVcpuFa } from "@/lib/labels/customer";
import {
  getInfrastructureStage,
  serviceOrderStatusLabel,
} from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { readParchinServiceSnapshot } from "@/lib/parchin/service-contract";
import { readyServerLocation } from "@/lib/cloud-servers/catalog";

export const metadata: Metadata = {
  title: "جزئیات سفارش | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const user = await requireCustomerPage();

  const { id } = await params;
  const { payment } = await searchParams;
  const order = await prisma.serviceOrder.findFirst({
    where: { id, userId: user.id },
    include: {
      plan: true,
      recommendationQuote: true,
      activationRequest: true,
      infrastructureOrder: {
        include: {
          provisioningJobs: { orderBy: { createdAt: "asc" } },
          healthChecks: { orderBy: { checkedAt: "asc" } },
          secureDeliveryEvents: { orderBy: { createdAt: "asc" } },
          cloudInstance: {
            select: {
              id: true,
              name: true,
              ipv4: true,
              region: true,
              size: true,
              image: true,
              status: true,
              credential: {
                select: {
                  status: true,
                  expiresAt: true,
                },
              },
              subscription: {
                select: {
                  status: true,
                  currentPeriodEnd: true,
                  graceEndsAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) notFound();
  const isPayg = order.plan?.billingModel === "PAYG_WALLET";
  const waitingForAdminProvision =
    isPayg
      ? order.activationRequest?.status === "WAITING_ADMIN_APPROVAL"
      : order.status === "PAID" &&
        order.infrastructureOrder?.status === "WAITING_ADMIN_FUNDING";
  const waitingForAdminDelivery =
    order.infrastructureOrder?.productFlowState ===
    "WAITING_ADMIN_DELIVERY_APPROVAL";
  const flowTransitions = await prisma.productFlowTransition.findMany({
    where: { serviceOrderId: order.id },
    orderBy: { createdAt: "asc" },
  });

  const planSnapshot =
    order.planSnapshot &&
    typeof order.planSnapshot === "object" &&
    !Array.isArray(order.planSnapshot)
      ? (order.planSnapshot as Record<string, unknown>)
      : null;
  const delivery =
    order.recommendationQuote?.deliveryConfigurationSnapshot &&
    typeof order.recommendationQuote.deliveryConfigurationSnapshot === "object" &&
    !Array.isArray(order.recommendationQuote.deliveryConfigurationSnapshot)
      ? (order.recommendationQuote.deliveryConfigurationSnapshot as Record<
          string,
          unknown
        >)
      : null;
  const parchin = readParchinServiceSnapshot(order.parchinServiceSnapshot);
  const regionCode =
    typeof planSnapshot?.regionCode === "string"
      ? planSnapshot.regionCode
      : order.plan?.regionCode ?? null;
  const location = regionCode ? readyServerLocation(regionCode).label : null;
  const vcpu =
    typeof planSnapshot?.vcpu === "number"
      ? planSnapshot.vcpu
      : order.plan?.vcpu ?? null;
  const ramGb =
    typeof planSnapshot?.ramGb === "number"
      ? planSnapshot.ramGb
      : typeof planSnapshot?.ramMb === "number"
        ? Math.ceil(planSnapshot.ramMb / 1024)
        : (order.plan?.ramGb ?? null);
  const diskGb =
    typeof planSnapshot?.diskGb === "number"
      ? planSnapshot.diskGb
      : typeof planSnapshot?.storageGb === "number"
        ? planSnapshot.storageGb
        : (order.plan?.storageGb ?? null);
  const osLabel =
    typeof delivery?.operatingSystem === "string"
      ? delivery.operatingSystem
      : typeof planSnapshot?.imageCode === "string"
        ? planSnapshot.imageCode
        : order.plan?.imageCode ?? null;
  const access =
    typeof delivery?.accessMethod === "string"
      ? accessMethodLabel(delivery.accessMethod)
      : null;
  const serverName =
    typeof delivery?.serverName === "string"
      ? delivery.serverName
      : order.infrastructureOrder?.cloudInstance?.name ?? null;
  const instanceActive =
    order.infrastructureOrder?.cloudInstance?.status === "ACTIVE";
  const quotePath = order.recommendationQuote
    ? order.productKind === "READY_INSTANT_SERVER"
      ? `/ready-servers/quote/${order.recommendationQuote.id}`
      : `/cloud-servers/quote/${order.recommendationQuote.id}`
    : null;
  const supportPath = `/account/support/requests/new?orderId=${order.id}${
    order.infrastructureOrder?.cloudInstance?.id
      ? `&instanceId=${order.infrastructureOrder.cloudInstance.id}`
      : ""
  }`;
  const nextAction =
    order.status === "PENDING_PAYMENT"
      ? {
          title: "پرداخت را تکمیل کنید",
          description:
            "سفارش هنوز پرداخت نشده است؛ پیش از هر برداشت، مبلغ و موجودی کیف پول را دوباره بررسی کنید.",
          href: quotePath,
          label: "بازگشت به پیش‌فاکتور",
        }
      : payment === "review"
        ? {
            title: "منتظر بررسی پرداخت بمانید",
            description:
              "پرداخت ثبت شده و تیم ابرچین نتیجه را بررسی می‌کند؛ پرداخت دیگری انجام ندهید.",
            href: supportPath,
            label: "پیگیری با پشتیبانی",
          }
        : waitingForAdminProvision
          ? {
              title: "تأیید ساخت توسط ابرچین",
              description:
                "پرداخت قطعی است؛ اقدام بعدی با تیم ابرچین است و هنوز منبعی در Provider ساخته نشده است.",
              href: null,
              label: null,
            }
          : waitingForAdminDelivery
            ? {
                title: "تأیید نهایی تحویل",
                description:
                  "آماده‌سازی تمام شده است؛ پس از تأیید دوم، اطلاعات دسترسی امن در همین صفحه ظاهر می‌شود.",
                href: null,
                label: null,
              }
            : instanceActive
              ? {
                  title: "دریافت اطلاعات دسترسی و مدیریت سرویس",
                  description:
                    "سرویس فعال است؛ اطلاعات تحویل، تمدید و تغییرات بعدی در همین صفحه در دسترس‌اند.",
                  href: "#delivery",
                  label: "رفتن به تحویل امن",
                }
              : order.status === "REFUNDED" || order.status === "CANCELED"
                ? {
                    title: "این سفارش بسته شده است",
                    description:
                      "برداشت یا عملیات دیگری برای این سفارش انجام نمی‌شود؛ سوابق مالی در کیف پول باقی می‌ماند.",
                    href: "/account/wallet",
                    label: "دیدن گردش کیف پول",
                  }
                : {
                    title: "وضعیت را به‌روزرسانی کنید",
                    description:
                      "اگر مرحله برای مدتی تغییر نکرده است، وضعیت را تازه کنید یا درخواست پشتیبانی بسازید.",
                    href: supportPath,
                    label: "درخواست پشتیبانی",
                  };
  const canRequestPreDeliveryCancel =
    !isPayg &&
    order.status === "PAID" &&
    !instanceActive &&
    order.infrastructureOrder?.status !== "REFUNDED" &&
    order.infrastructureOrder?.status !== "CANCELED";

  const timeline = [
    {
      id: "created",
      title: isPayg ? "ثبت درخواست" : "ثبت سفارش",
      description: new Date(order.createdAt).toLocaleString("fa-IR"),
      done: true,
    },
    {
      id: "paid",
      title: isPayg ? "بررسی اعتبار کیف پول" : "پرداخت",
      description: isPayg
        ? order.activationRequest?.status === "CREDIT_REQUIRED"
          ? "نیازمند شارژ کیف پول"
          : "اعتبار اولیه بررسی شد"
        : order.paidAt
          ? new Date(order.paidAt).toLocaleString("fa-IR")
          : "در انتظار پرداخت",
      done: isPayg
        ? order.activationRequest?.status !== "CREDIT_REQUIRED"
        : Boolean(order.paidAt),
    },
    ...(order.infrastructureOrder
      ? [
          {
            id: "infra",
            title: "آماده‌سازی سرور",
            description: waitingForAdminProvision
              ? "پرداخت/درخواست ثبت شد؛ منتظر تأیید ساخت ابرچین"
              : waitingForAdminDelivery
                ? "آماده‌سازی کامل شد؛ منتظر تأیید نهایی تحویل"
                : getInfrastructureStage(order.infrastructureOrder.status),
            done: order.infrastructureOrder.status === "ACTIVE",
          },
          ...order.infrastructureOrder.healthChecks.map((check) => ({
            id: check.id,
            title: "بررسی سلامت",
            description:
              check.status === "SUCCEEDED"
                ? "اتصال امن و وضعیت شبکه تأیید شد"
                : check.status === "FAILED"
                  ? "ناموفق؛ امکان تلاش دوباره یا بررسی انسانی وجود دارد"
                  : "در حال بررسی",
            done: check.status === "SUCCEEDED",
          })),
          ...order.infrastructureOrder.secureDeliveryEvents.map((event) => ({
            id: event.id,
            title: "تحویل امن",
            description:
              event.status === "DELIVERED"
                ? "اطلاعات دسترسی رمزنگاری‌شده آماده است"
                : "در انتظار آماده‌شدن اطلاعات دسترسی امن",
            done: event.status === "DELIVERED",
          })),
        ]
      : []),
    ...flowTransitions.map((transition) => ({
      id: transition.id,
      title:
        transition.toState === "ACTIVE"
          ? "فعال"
          : transition.toState === "PROVISIONING_RECONCILING"
            ? "در حال تکمیل تحویل"
            : "به‌روزرسانی وضعیت",
      description:
        transition.toState === "PROVISIONING_RECONCILING"
          ? "در حال تکمیل تحویل توسط ابرچین"
          : transition.toState === "PROVISIONING_RETRYABLE" ||
              transition.toState === "DELIVERY_RETRYABLE"
            ? "قابل تلاش دوباره یا ارجاع به پشتیبانی"
            : transition.reason ?? "وضعیت سفارش به‌روزرسانی شد",
      done: transition.toState === "ACTIVE",
    })),
  ];

  const resourcesLabel =
    vcpu || ramGb || diskGb
      ? [
          vcpu != null ? specVcpuFa(vcpu) : null,
          ramGb != null ? `${specGbFa(ramGb)} رم` : null,
          diskGb != null ? `${specGbFa(diskGb)} دیسک` : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;

  return (
    <>
      <PageHeader
        title={order.title}
        description={`سفارش ${order.id.slice(-8)}`}
        actions={<OrderStatusRefresh />}
      />
      <SectionCard title="خلاصه">
        <p>
          وضعیت:{" "}
          <StatusBadge label={serviceOrderStatusLabel[order.status]} tone="info" />
        </p>
        <p>
          مدل خرید:{" "}
          <strong>{customerBillingModelLabel(order.plan?.billingModel)}</strong>
        </p>
        {!isPayg ? (
          <p>
            مبلغ پرداخت‌شده: <MoneyDisplay amount={formatTomanFa(order.amount)} />
          </p>
        ) : (
          <p>
            تخمین روزانه (سرویس قدیمی):{" "}
            <MoneyDisplay
              amount={formatTomanFa(
                order.activationRequest?.estimatedDailyRial ?? 0n,
              )}
            />
          </p>
        )}
        {waitingForAdminProvision ? (
          <p role="status">
            {isPayg
              ? "درخواست ثبت شده و منتظر تأیید ساخت ابرچین است."
              : "پرداخت موفق؛ منتظر تأیید ساخت ابرچین"}
          </p>
        ) : waitingForAdminDelivery ? (
          <p role="status">
            سرور در حال آماده‌سازی نهایی است و پس از تأیید تحویل، اطلاعات دسترسی
            امن در همین صفحه آماده می‌شود.
          </p>
        ) : payment === "review" ? (
          <p role="status">پرداخت دریافت شده و در انتظار بررسی پشتیبانی است.</p>
        ) : payment === "canceled" || payment === "failed" ? (
          <p role="status">پرداخت نهایی نشد؛ می‌توانید دوباره اقدام کنید.</p>
        ) : null}
      </SectionCard>

      <SectionCard title="اقدام بعدی">
        <h3 style={{ marginTop: 0 }}>{nextAction.title}</h3>
        <p>{nextAction.description}</p>
        {nextAction.href && nextAction.label ? (
          <Link className="product-btn product-btn--primary" href={nextAction.href}>
            {nextAction.label}
          </Link>
        ) : null}
      </SectionCard>

      <SectionCard title="قرارداد خرید (قفل‌شده در زمان سفارش)">
        {resourcesLabel ? (
          <p>
            منابع: <strong dir="ltr">{resourcesLabel}</strong>
          </p>
        ) : null}
        {location ? (
          <p>
            موقعیت: <strong>{location}</strong>
          </p>
        ) : null}
        {osLabel ? (
          <p>
            سیستم‌عامل: <strong dir="ltr">{osLabel}</strong>
          </p>
        ) : null}
        {access ? (
          <p>
            روش دسترسی: <strong>{access}</strong>
          </p>
        ) : null}
        {serverName ? (
          <p>
            نام سرور: <strong dir="ltr">{serverName}</strong>
          </p>
        ) : null}
        <p>
          مدت: <strong>{order.termMonths.toLocaleString("fa-IR")} ماه</strong>
          {effectiveTermDiscountLabel(order.termDiscountBps)
            ? ` · ${effectiveTermDiscountLabel(order.termDiscountBps)}`
            : ""}
        </p>
        {parchin ? (
          <>
            <p>
              پرچین:{" "}
              <strong>
                {parchin.title} · نسخه {parchin.version.toLocaleString("fa-IR")}
              </strong>
            </p>
            <p>{parchin.description}</p>
            <h3>خدمات شامل</h3>
            <ul>
              {parchin.includedServices.map((item) => (
                <li key={`in-${item}`}>{item}</li>
              ))}
            </ul>
            <h3>مرز تعهد این سطح</h3>
            <ul>
              {parchin.excludedServices.map((item) => (
                <li key={`ex-${item}`}>{item}</li>
              ))}
            </ul>
            <small>
              خدمات این بخش قابل سفارش جداگانه‌اند، اما جزو تعهد ماهانه این سطح
              نیستند. قرارداد خرید با تغییر بعدی تنظیمات پرچین عوض نمی‌شود.
            </small>
          </>
        ) : (
          <p>قرارداد پرچین برای این سفارش ثبت نشده است.</p>
        )}
        <p style={{ marginTop: 12 }}>
          <Link
            className="product-btn product-btn--quiet"
            href={supportPath}
          >
            درخواست پشتیبانی برای این سرویس
          </Link>
        </p>
      </SectionCard>

      <SectionCard title="زمان‌بندی">
        <Timeline items={timeline} />
      </SectionCard>
      {order.infrastructureOrder?.cloudInstance?.status === "ACTIVE" &&
      order.infrastructureOrder.cloudInstance.ipv4 ? (
        <>
          <SectionCard title="اطلاعات سرویس">
            <p>
              IP:{" "}
              <strong dir="ltr">
                {order.infrastructureOrder.cloudInstance.ipv4}
              </strong>
            </p>
            <p>
              موقعیت:{" "}
              <strong dir="ltr">
                {order.infrastructureOrder.cloudInstance.region}
              </strong>
            </p>
            <p>
              پلن / سیستم‌عامل:{" "}
              <strong dir="ltr">
                {order.infrastructureOrder.cloudInstance.size} /{" "}
                {order.infrastructureOrder.cloudInstance.image}
              </strong>
            </p>
          </SectionCard>
          <SectionCard title="تحویل امن سرور">
            <div id="delivery">
            <CredentialRevealPanel
              instanceId={order.infrastructureOrder.cloudInstance.id}
              ipv4={order.infrastructureOrder.cloudInstance.ipv4}
              credentialStatus={
                order.infrastructureOrder.cloudInstance.credential?.status ?? null
              }
              credentialExpiresAt={
                order.infrastructureOrder.cloudInstance.credential?.expiresAt.toISOString() ??
                null
              }
            />
            </div>
          </SectionCard>
        </>
      ) : null}
      {canRequestPreDeliveryCancel ? (
        <SectionCard title="لغو پیش از تحویل">
          <p>
            تا پیش از تحویل می‌توانید درخواست لغو ثبت کنید. تیم ابرچین ابتدا
            وضعیت واقعی منبع را بررسی می‌کند؛ بازگشت اعتبار فقط پس از تأیید امن
            نبودن عملیات فعال و از مسیر Ledger انجام می‌شود.
          </p>
          <Link
            className="product-btn product-btn--quiet"
            href={`/account/support/requests/new?orderId=${order.id}&intent=cancel-before-delivery`}
          >
            ثبت درخواست لغو پیش از تحویل
          </Link>
        </SectionCard>
      ) : null}
      {!isPayg && order.infrastructureOrder?.cloudInstance?.subscription ? (
        <SectionCard title="تمدید">
          <SubscriptionPanel
            instanceId={order.infrastructureOrder.cloudInstance.id}
            status={order.infrastructureOrder.cloudInstance.subscription.status}
            currentPeriodEnd={
              order.infrastructureOrder.cloudInstance.subscription.currentPeriodEnd.toISOString()
            }
            graceEndsAt={
              order.infrastructureOrder.cloudInstance.subscription.graceEndsAt.toISOString()
            }
            previousPeriodAmountRial={order.amount.toString()}
            serverName={
              order.infrastructureOrder.cloudInstance.name || serverName
            }
            resourcesLabel={resourcesLabel}
          />
        </SectionCard>
      ) : null}
      {!isPayg &&
      order.infrastructureOrder?.cloudInstance?.status === "ACTIVE" &&
      order.infrastructureOrder.cloudInstance.subscription ? (
        <SectionCard title="لغو سرویس">
          <div id="cancel-service">
            <ServiceCancelPanel
              instanceId={order.infrastructureOrder.cloudInstance.id}
              serverName={
                order.infrastructureOrder.cloudInstance.name || serverName || "سرور"
              }
            />
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}
