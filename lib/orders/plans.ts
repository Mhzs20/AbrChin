import type { DeliveryMode, InfrastructurePlan, InfrastructureProvider } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { tomanToRial } from "@/lib/money";

export type PlanSnapshot = {
  code: string;
  title: string;
  description: string | null;
  provider: InfrastructureProvider;
  regionCode: string;
  sizeCode: string;
  imageCode: string;
  deliveryMode: DeliveryMode;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  salePriceRial: string;
  renewalPriceRial: string | null;
  estimatedProviderCostRial: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
};

export type PublicPlanOffer = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  deliveryMode: DeliveryMode;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  salePriceRial: string;
  renewalPriceRial: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
};

export function toPlanSnapshot(plan: InfrastructurePlan): PlanSnapshot {
  return {
    code: plan.code,
    title: plan.title,
    description: plan.description,
    provider: plan.provider,
    regionCode: plan.regionCode,
    sizeCode: plan.sizeCode,
    imageCode: plan.imageCode,
    deliveryMode: plan.deliveryMode,
    vcpu: plan.vcpu,
    ramGb: plan.ramGb,
    storageGb: plan.storageGb,
    salePriceRial: plan.salePriceRial.toString(),
    renewalPriceRial: plan.renewalPriceRial?.toString() ?? null,
    estimatedProviderCostRial: plan.estimatedProviderCostRial.toString(),
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
  };
}

export function toPublicPlanOffer(plan: InfrastructurePlan): PublicPlanOffer {
  return {
    id: plan.id,
    code: plan.code,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    vcpu: plan.vcpu,
    ramGb: plan.ramGb,
    storageGb: plan.storageGb,
    salePriceRial: plan.salePriceRial.toString(),
    renewalPriceRial: (plan.renewalPriceRial ?? plan.salePriceRial).toString(),
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
  };
}

export async function getActivePlanByCode(code: string) {
  return prisma.infrastructurePlan.findFirst({
    where: { code, active: true },
  });
}

export async function getActivePlanById(id: string) {
  return prisma.infrastructurePlan.findFirst({
    where: { id, active: true },
  });
}

export async function listActivePlans() {
  return prisma.infrastructurePlan.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function listPublicPlanOffers() {
  const plans = await listActivePlans();
  return plans.map(toPublicPlanOffer);
}

export async function listAllPlans() {
  return prisma.infrastructurePlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** Development/test seed only — never called in production bootstrap. */
export async function seedDevelopmentPlans() {
  if (getEnv().isProduction) return;

  const plans = [
    {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      description: "پلن آزمایشی فقط برای Development",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW" as const,
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      sortOrder: 1,
    },
    {
      code: "DEV_GROWTH",
      title: "رشد توسعه",
      description: "پلن آزمایشی فقط برای Development",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "MANAGED" as const,
      salePriceRial: tomanToRial(450_000),
      estimatedProviderCostRial: tomanToRial(380_000),
      sortOrder: 2,
    },
  ];

  for (const plan of plans) {
    await prisma.infrastructurePlan.upsert({
      where: { code: plan.code },
      update: {},
      create: {
        ...plan,
        provider: "PARSPACK",
        active: true,
      },
    });
  }
}

/** @deprecated Use getActivePlanByCode from database */
export function getServicePlan(code: string) {
  void code;
  return null;
}
