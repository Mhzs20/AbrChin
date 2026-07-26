import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MoneyDisplay, PageHeader, SectionCard, StatusBadge, Timeline } from "@/components/product";
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
    include: { infrastructureOrder: { include: { provisioningJobs: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!order) notFound();

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
        ]
      : []),
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
    </>
  );
}
