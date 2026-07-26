import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  CloudInstanceStatus,
  InfrastructureOrderStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  PrismaClient,
  ProvisioningJobStatus,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { confirmProviderFunding } from "../lib/infrastructure/funding.ts";
import { createMockProviderWithBehavior } from "../lib/infrastructure/mock-provider.ts";
import {
  claimNextProvisioningJob,
  processProvisioningJob,
  recoverExpiredProvisioningJobs,
} from "../lib/infrastructure/provisioning-service.ts";
import { refundOrder } from "../lib/orders/service.ts";
import { reverseLedgerEntry } from "../lib/wallet/ledger.ts";
import { tomanToRial } from "../lib/money.ts";

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

function requirePrisma(t: { skip: (message?: string) => void }) {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return null;
  }
  return prisma;
}

async function seedInfra(mobile: string, suffix: string) {
  const db = prisma!;
  await db.user.deleteMany({ where: { mobile } });
  const plan = await db.infrastructurePlan.upsert({
    where: { code: "DEV_STARTER" },
    update: {},
    create: {
      code: "DEV_STARTER",
      title: "شروع",
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
  const user = await db.user.create({ data: { mobile } });
  const serviceOrder = await db.serviceOrder.create({
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
  const infra = await db.infrastructureOrder.create({
    data: {
      serviceOrderId: serviceOrder.id,
      userId: user.id,
      planId: plan.id,
      provider: plan.provider,
      deliveryMode: plan.deliveryMode,
      status: InfrastructureOrderStatus.QUEUED,
      requiredFundingRial: plan.estimatedProviderCostRial,
      desiredInstanceName: `abrchin-test-${suffix}`,
    },
  });
  const job = await db.provisioningJob.create({
    data: {
      infrastructureOrderId: infra.id,
      operation: "create_instance",
      status: ProvisioningJobStatus.QUEUED,
      idempotencyKey: `hardening_${suffix}_a1`,
      attempt: 1,
    },
  });
  return { user, plan, serviceOrder, infra, job };
}

test("failure before create leaves order retryable without cloud instance", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883001";
  const { infra, job } = await seedInfra(mobile, "pre");
  const provider = createMockProviderWithBehavior("blocked");
  const claimed = await claimNextProvisioningJob("worker-a");
  assert.ok(claimed);
  assert.equal(claimed.id, job.id);
  await processProvisioningJob(claimed.id, provider);
  const refreshed = await db.infrastructureOrder.findUniqueOrThrow({ where: { id: infra.id } });
  const cloud = await db.cloudInstance.count({ where: { infrastructureOrderId: infra.id } });
  assert.equal(cloud, 0);
  assert.equal(refreshed.status, InfrastructureOrderStatus.WAITING_ADMIN_FUNDING);
  await db.provisioningJob.delete({ where: { id: job.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile } });
});

test("timeout after create marks NEEDS_RECONCILIATION without second create", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883002";
  const { infra, job } = await seedInfra(mobile, "timeout");
  await db.provisioningJob.update({
    where: { id: job.id },
    data: { createSentAt: new Date(), status: ProvisioningJobStatus.RUNNING, startedAt: new Date() },
  });
  const provider = createMockProviderWithBehavior("timeout");
  await processProvisioningJob(job.id, provider);
  const refreshed = await db.infrastructureOrder.findUniqueOrThrow({ where: { id: infra.id } });
  assert.equal(refreshed.status, InfrastructureOrderStatus.NEEDS_RECONCILIATION);
  const cloud = await db.cloudInstance.count({ where: { infrastructureOrderId: infra.id } });
  assert.equal(cloud, 0);
  await db.provisioningJob.delete({ where: { id: job.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile } });
});

test("expired lease before create requeues job", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883003";
  const { job } = await seedInfra(mobile, "lease");
  await db.provisioningJob.update({
    where: { id: job.id },
    data: {
      status: ProvisioningJobStatus.RUNNING,
      leaseExpiresAt: new Date(Date.now() - 1000),
      workerId: "stale-worker",
    },
  });
  await recoverExpiredProvisioningJobs();
  const refreshed = await db.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(refreshed.status, ProvisioningJobStatus.QUEUED);
  await db.provisioningJob.delete({ where: { id: job.id } });
  await db.infrastructureOrder.deleteMany({ where: { id: job.infrastructureOrderId } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile } });
});

test("refund blocked for active cloud instance", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883004";
  const adminMobile = "09128883005";
  const { user, serviceOrder, infra } = await seedInfra(mobile, "refund");
  const admin = await db.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  await db.cloudInstance.create({
    data: {
      infrastructureOrderId: infra.id,
      userId: user.id,
      provider: "PARSPACK",
      providerInstanceId: "vm_test_1",
      name: "test",
      region: "tehran11",
      size: "irLinuxVPS4",
      image: "ubuntu24-cloudinit-qcow2",
      deliveryMode: "RAW",
      status: CloudInstanceStatus.ACTIVE,
    },
  });
  await db.infrastructureOrder.update({
    where: { id: infra.id },
    data: { status: InfrastructureOrderStatus.ACTIVE },
  });
  await db.wallet.create({ data: { userId: user.id, availableBalance: 0n, status: WalletStatus.ACTIVE } });
  await db.walletLedgerEntry.create({
    data: {
      walletId: (await db.wallet.findUniqueOrThrow({ where: { userId: user.id } })).id,
      direction: LedgerDirection.DEBIT,
      type: LedgerType.SERVICE_PURCHASE,
      amount: serviceOrder.amount,
      status: LedgerStatus.COMPLETED,
      referenceType: "order",
      referenceId: serviceOrder.id,
      idempotencyKey: `order_pay_${serviceOrder.id}`,
      balanceAfter: 0n,
    },
  });

  await assert.rejects(
    () =>
      refundOrder({
        orderId: serviceOrder.id,
        actorUserId: admin.id,
        reason: "test refund",
      }),
    (error: Error & { code?: string }) => error.code === "refund_blocked",
  );

  const ledgerCount = await db.walletLedgerEntry.count({
    where: { referenceId: serviceOrder.id, type: LedgerType.REFUND },
  });
  assert.equal(ledgerCount, 0);
  await db.cloudInstance.deleteMany({ where: { infrastructureOrderId: infra.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.delete({ where: { id: serviceOrder.id } });
  await db.user.deleteMany({ where: { mobile: { in: [mobile, adminMobile] } } });
});

test("funding idempotency key replay returns same confirmation", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883006";
  const adminMobile = "09128883007";
  const { infra } = await seedInfra(mobile, "fund");
  await db.user.deleteMany({ where: { mobile: adminMobile } });
  const admin = await db.user.create({ data: { mobile: adminMobile, role: "ADMIN" } });
  await db.infrastructureOrder.update({
    where: { id: infra.id },
    data: { status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING },
  });
  await db.provisioningJob.deleteMany({ where: { infrastructureOrderId: infra.id } });
  const key = "funding-key-replay-1";
  const first = await confirmProviderFunding({
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    fundedAmountToman: 150_000,
    idempotencyKey: key,
  });
  const second = await confirmProviderFunding({
    infrastructureOrderId: infra.id,
    adminUserId: admin.id,
    fundedAmountToman: 150_000,
    idempotencyKey: key,
  });
  assert.equal(first.fundingConfirmation.id, second.fundingConfirmation.id);
  const count = await db.providerFundingConfirmation.count({ where: { infrastructureOrderId: infra.id } });
  assert.equal(count, 1);
  await db.providerFundingConfirmation.deleteMany({ where: { infrastructureOrderId: infra.id } });
  await db.provisioningJob.deleteMany({ where: { infrastructureOrderId: infra.id } });
  await db.infrastructureOrder.delete({ where: { id: infra.id } });
  await db.serviceOrder.deleteMany({ where: { user: { mobile } } });
  await db.user.deleteMany({ where: { mobile: { in: [mobile, adminMobile] } } });
});

test("ledger reverse is idempotent under duplicate requests", async (t) => {
  const db = requirePrisma(t);
  if (!db) return;
  const mobile = "09128883008";
  await db.user.deleteMany({ where: { mobile } });
  const user = await db.user.create({ data: { mobile } });
  const wallet = await db.wallet.create({
    data: { userId: user.id, availableBalance: tomanToRial(100_000), status: WalletStatus.ACTIVE },
  });
  const debit = await db.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      direction: LedgerDirection.DEBIT,
      type: LedgerType.SERVICE_PURCHASE,
      amount: tomanToRial(10_000),
      status: LedgerStatus.COMPLETED,
      idempotencyKey: `debit_${mobile}`,
      balanceAfter: tomanToRial(90_000),
    },
  });
  const key = `reverse_${debit.id}`;
  const first = await reverseLedgerEntry({
    userId: user.id,
    originalEntryId: debit.id,
    idempotencyKey: key,
    description: "test",
  });
  const second = await reverseLedgerEntry({
    userId: user.id,
    originalEntryId: debit.id,
    idempotencyKey: key,
    description: "test",
  });
  assert.equal(first.id, second.id);
  const reverseCount = await db.walletLedgerEntry.count({ where: { reversedEntryId: debit.id } });
  assert.equal(reverseCount, 1);
  await db.walletLedgerEntry.deleteMany({ where: { walletId: wallet.id } });
  await db.wallet.delete({ where: { id: wallet.id } });
  await db.user.delete({ where: { id: user.id } });
});
