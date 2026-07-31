import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MoneyDisplay, PageHeader, SectionCard, StatusBadge, Timeline } from "@/components/product";
import { CredentialRevealPanel } from "@/components/account/credential-reveal-panel";
import { SubscriptionPanel } from "@/components/account/subscription-panel";
import { prisma } from "@/lib/db";
import {
  getInfrastructureStage,
  serviceOrderStatusLabel,
} from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "جزئیات سفارش | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;
  const order = await prisma.serviceOrder.findFirst({
    where: { id, userId: user.id },
    include: {
      infrastructureOrder: {
        include: {
          provisioningJobs: { orderBy: { createdAt: "asc" } },
          healthChecks: { orderBy: { checkedAt: "asc" } },
          secureDeliveryEvents: { orderBy: { createdAt: "asc" } },
          cloudInstance: {
            select: {
              id: true,
              ipv4: true,
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
  const flowTransitions = await prisma.productFlowTransition.findMany({
    where: { serviceOrderId: order.id },
    orderBy: { createdAt: "asc" },
  });

  const timeline = [
    { id: "created", title: "ثبت سفارش", description: new Date(order.createdAt).toLocaleString("fa-IR"), done: true },
    {
      id: "paid",
      title: "پرداخت",
      description: order.paidAt ? new Date(order.paidAt).toLocaleString("fa-IR") : "در انتظار پرداخت",
      done: Boolean(order.paidAt),
    },
    ...(order.infrastructureOrder
      ? [
          {
            id: "infra",
            title: "آماده‌سازی زیرساخت",
            description: getInfrastructureStage(order.infrastructureOrder.status),
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
          ...order.infrastructureOrder.secureDeliveryEvents.map(
            (event) => ({
              id: event.id,
              title: "تحویل امن",
              description:
                event.status === "DELIVERED"
                  ? "اطلاعات دسترسی رمزنگاری‌شده آماده است"
                  : "در انتظار آماده‌شدن اطلاعات دسترسی امن",
              done: event.status === "DELIVERED",
            }),
          ),
        ]
      : []),
    ...flowTransitions.map((transition) => ({
      id: transition.id,
      title: transition.toState,
      description:
        transition.toState === "PROVISIONING_RECONCILING"
          ? "در حال تطبیق با Provider؛ ساخت تکراری انجام نمی‌شود"
          : transition.toState === "PROVISIONING_RETRYABLE" ||
              transition.toState === "DELIVERY_RETRYABLE"
            ? "قابل تلاش دوباره یا ارجاع به پشتیبانی"
            : transition.reason ?? "وضعیت جریان به‌روزرسانی شد",
      done: transition.toState === "ACTIVE",
    })),
  ];

  return (
    <>
      <PageHeader title={order.title} description={`سفارش ${order.id.slice(-8)}`} />
      <SectionCard title="خلاصه">
        <p>وضعیت: <StatusBadge label={serviceOrderStatusLabel[order.status]} tone="info" /></p>
        <p>مبلغ: <MoneyDisplay amount={formatTomanFa(order.amount)} /></p>
      </SectionCard>
      <SectionCard title="زمان‌بندی">
        <Timeline items={timeline} />
      </SectionCard>
      {order.infrastructureOrder?.cloudInstance?.status === "ACTIVE" &&
      order.infrastructureOrder.cloudInstance.ipv4 ? (
        <SectionCard title="تحویل امن سرور">
          <CredentialRevealPanel
            instanceId={order.infrastructureOrder.cloudInstance.id}
            ipv4={order.infrastructureOrder.cloudInstance.ipv4}
            credentialStatus={
              order.infrastructureOrder.cloudInstance.credential?.status ?? null
            }
            credentialExpiresAt={
              order.infrastructureOrder.cloudInstance.credential?.expiresAt.toISOString() ?? null
            }
          />
        </SectionCard>
      ) : null}
      {order.infrastructureOrder?.cloudInstance?.subscription ? (
        <SectionCard title="تمدید و چرخه عمر">
          <SubscriptionPanel
            instanceId={order.infrastructureOrder.cloudInstance.id}
            status={order.infrastructureOrder.cloudInstance.subscription.status}
            currentPeriodEnd={
              order.infrastructureOrder.cloudInstance.subscription.currentPeriodEnd.toISOString()
            }
            graceEndsAt={
              order.infrastructureOrder.cloudInstance.subscription.graceEndsAt.toISOString()
            }
          />
        </SectionCard>
      ) : null}
    </>
  );
}
