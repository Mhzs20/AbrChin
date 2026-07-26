import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  InfrastructureOrderStatus,
  PrismaClient,
  ProvisioningJobStatus,
  ServiceOrderStatus,
} from "@prisma/client";

import { claimNextProvisioningJob } from "../lib/infrastructure/provisioning-service.ts";
import { tomanToRial } from "../lib/money.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl ? new PrismaClient() : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function seedQueuedJob() {
  if (!prisma) throw new Error("no prisma");
  const mobile = "09128882001";
  await prisma.provisioningJob.deleteMany({
    where: { infrastructureOrder: { user: { mobile } } },
  });
  await prisma.infrastructureOrder.deleteMany({ where: { user: { mobile } } });
  await prisma.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });

  const plan = await prisma.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {},
    create: {
      code: "DEV_STARTER",
      title: "شروع توسعه",
      provider: "PARSPACK",
      regionCode: "tehran11",
      sizeCode: "irLinuxVPS4",
      imageCode: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      salePriceRial: tomanToRial(150_000),
      estimatedProviderCostRial: tomanToRial(120_000),
      active: true,
      sortOrder: 1,
    },
  });

  const user = await prisma.user.create({ data: { mobile } });
  const serviceOrder = await prisma.serviceOrder.create({
    data: {
      userId: user.id,
      title: plan.title,
      amount: plan.salePriceRial,
      status: ServiceOrderStatus.PAID,
      planId: plan.id,
      planCode: plan.code,
      paidAt: new Date(),
    },
  });
  const infra = await prisma.infrastructureOrder.create({
    data: {
      serviceOrderId: serviceOrder.id,
      userId: user.id,
      planId: plan.id,
      provider: plan.provider,
      deliveryMode: plan.deliveryMode,
      status: InfrastructureOrderStatus.QUEUED,
      requiredFundingRial: plan.estimatedProviderCostRial,
    },
  });
  const job = await prisma.provisioningJob.create({
    data: {
      infrastructureOrderId: infra.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.QUEUED,
      idempotencyKey: `worker_test_${infra.id}_a1`,
      attempt: 1,
    },
  });
  return { job, infra, mobile };
}

test("claimNextProvisioningJob is exclusive under concurrent workers", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const { job, mobile } = await seedQueuedJob();

  const [first, second] = await Promise.all([claimNextProvisioningJob(), claimNextProvisioningJob()]);
  const claimed = [first, second].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.id, job.id);

  const refreshed = await prisma.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(refreshed.status, ProvisioningJobStatus.RUNNING);

  await prisma.provisioningJob.delete({ where: { id: job.id } });
  await prisma.infrastructureOrder.deleteMany({ where: { id: job.infrastructureOrderId } });
  await prisma.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await prisma.user.deleteMany({ where: { mobile } });
});
