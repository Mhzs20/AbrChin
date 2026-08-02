import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader, SectionCard, Timeline } from "@/components/product";
import { InstanceCredentialForm } from "@/components/admin/instance-credential-form";
import { AdminCredentialReveal } from "@/components/admin/admin-credential-reveal";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { getInfrastructureStage } from "@/lib/labels/infrastructure";

export const metadata: Metadata = {
  title: "جزئیات سرور | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminInstanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const { id } = await params;
  const instance = await prisma.cloudInstance.findUnique({
    where: { id },
    include: {
      user: true,
      credential: {
        select: {
          status: true,
          username: true,
          expiresAt: true,
          revealedAt: true,
        },
      },
      infrastructureOrder: {
        include: {
          plan: true,
          fundingConfirmations: { orderBy: { attempt: "asc" } },
          provisioningJobs: { orderBy: { createdAt: "asc" } },
          operationLogs: { orderBy: { createdAt: "asc" }, take: 20 },
        },
      },
    },
  });
  if (!instance) notFound();

  const order = instance.infrastructureOrder;

  return (
    <>
      <PageHeader title={instance.name} description={`Instance ${instance.providerInstanceId}`} />
      <SectionCard title="اطلاعات سرویس">
        <p>مشتری: {instance.user.mobile}</p>
        <p>IP: <span className="product-tech">{instance.ipv4 || "—"}</span></p>
        <p>Region/Size/Image: <span className="product-tech">{instance.region} / {instance.size} / {instance.image}</span></p>
      </SectionCard>
      <SectionCard title="Timeline">
        <Timeline
          items={[
            {
              id: "funding",
              title: "تأمین",
              description:
                order.fundingConfirmations.length > 0
                  ? `${order.fundingConfirmations.length.toLocaleString("fa-IR")} تأیید`
                  : "—",
              done: order.fundingConfirmations.length > 0,
            },
            { id: "stage", title: "مرحله", description: getInfrastructureStage(order.status), done: order.status === "ACTIVE" },
            ...order.provisioningJobs.map((job) => ({
              id: job.id,
              title: `Job ${job.operation}`,
              description: job.status,
              done: job.status === "SUCCEEDED",
            })),
          ]}
        />
      </SectionCard>
      <SectionCard title="تحویل امن دسترسی">
        {order.productFlowState === "WAITING_ADMIN_DELIVERY_APPROVAL" ? (
          <AdminCredentialReveal
            instanceId={instance.id}
            credentialStatus={instance.credential?.status ?? null}
          />
        ) : null}
        <InstanceCredentialForm
          instanceId={instance.id}
          currentStatus={instance.credential?.status ?? null}
        />
      </SectionCard>
    </>
  );
}
