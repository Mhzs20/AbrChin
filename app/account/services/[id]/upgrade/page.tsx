import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ServiceUpgradeChooser } from "@/components/account/service-upgrade-panels";
import { PageHeader } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "ارتقای سرور | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ServiceUpgradePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerPage();
  const { id } = await params;
  const instance = await prisma.cloudInstance.findFirst({
    where: { id, userId: user.id, status: "ACTIVE" },
    include: {
      infrastructureOrder: { include: { plan: true } },
    },
  });
  if (!instance) notFound();

  const plan = instance.infrastructureOrder.plan;

  return (
    <>
      <PageHeader
        title="ارتقای سرور"
        description="منابع فعلی را ببین و فقط مقصدهای مجاز بزرگ‌تر را انتخاب کن."
      />
      <ServiceUpgradeChooser
        instanceId={instance.id}
        serverName={instance.name}
        initialCurrent={{
          vcpu: plan.vcpu,
          ramGb: plan.ramGb,
          diskGb: plan.storageGb,
        }}
      />
    </>
  );
}
