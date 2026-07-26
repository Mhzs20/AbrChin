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
  salePriceRial: string;
  estimatedProviderCostRial: string;
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
    salePriceRial: plan.salePriceRial.toString(),
    estimatedProviderCostRial: plan.estimatedProviderCostRial.toString(),
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
