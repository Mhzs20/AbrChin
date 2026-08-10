import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { prisma } from "../lib/db.ts";
import {
  completeCancellationAfterTermination,
  requestCustomerServiceCancellation,
} from "../lib/orders/customer-cancel-service.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("Phase 6 cancellation test requires isolated PostgreSQL");
}
process.env.ARVAN_ENABLED = "false";
process.env.ARVAN_MUTATIONS_ENABLED = "false";

after(async () => {
  await prisma.$disconnect();
});

test("confirmed prepaid cancellation credits one Ledger entry without provider mutation", async () => {
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const now = new Date();
  const periodStart = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1_000);
  const periodEnd = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1_000);
  const [customer, admin] = await Promise.all([
    prisma.user.create({
      data: {
        mobile: `0912${randomBytes(4).readUInt32BE(0).toString().padStart(7, "0").slice(0, 7)}`,
        role: "CUSTOMER",
        accountStatus: "ACTIVE",
      },
    }),
    prisma.user.create({
      data: {
        mobile: `0935${randomBytes(4).readUInt32BE(0).toString().padStart(7, "0").slice(0, 7)}`,
        role: "ADMIN",
        accountStatus: "ACTIVE",
      },
    }),
  ]);
  const wallet = await prisma.wallet.create({
    data: { userId: customer.id, availableBalance: 0n, status: "ACTIVE" },
  });
  const plan = await prisma.infrastructurePlan.create({
    data: {
      code: `PHASE6_CANCEL_${suffix}`,
      title: "Phase 6 cancellation fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: `phase6-${suffix}`,
      sizeCode: "phase6-cancel",
      imageCode: "ubuntu-24.04",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 30_000_000n,
      renewalPriceRial: 30_000_000n,
      estimatedProviderCostRial: 20_000_000n,
      billingModel: "PREPAID_TERM",
      active: true,
      publicationStatus: "PUBLISHED",
    },
  });
  const order = await prisma.serviceOrder.create({
    data: {
      userId: customer.id,
      title: plan.title,
      amount: 30_000_000n,
      termMonths: 1,
      status: "PAID",
      planId: plan.id,
      planCode: plan.code,
      paidAt: periodStart,
      productFlowState: "ACTIVE",
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
    },
  });
  const infrastructureOrder = await prisma.infrastructureOrder.create({
    data: {
      serviceOrderId: order.id,
      userId: customer.id,
      planId: plan.id,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      deliveryMode: plan.deliveryMode,
      status: "ACTIVE",
      requiredFundingRial: 20_000_000n,
      desiredInstanceName: `phase6-${suffix}`,
      productFlowState: "ACTIVE",
    },
  });
  const instance = await prisma.cloudInstance.create({
    data: {
      infrastructureOrderId: infrastructureOrder.id,
      userId: customer.id,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      providerInstanceId: `phase6-resource-${suffix}`,
      name: `phase6-${suffix}`,
      region: plan.regionCode,
      size: plan.sizeCode,
      image: plan.imageCode,
      deliveryMode: plan.deliveryMode,
      ipv4: "203.0.113.66",
      providerState: "active",
      providerObservedAt: periodStart,
      status: "ACTIVE",
      provisionedAt: periodStart,
      deliveredAt: periodStart,
    },
  });
  await prisma.serviceSubscription.create({
    data: {
      cloudInstanceId: instance.id,
      sourceOrderId: order.id,
      userId: customer.id,
      planId: plan.id,
      status: "ACTIVE",
      renewalPriceRial: 30_000_000n,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextRenewalAt: periodEnd,
      graceEndsAt: new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1_000),
      termMonths: 1,
      autoRenew: false,
    },
  });

  const requested = await requestCustomerServiceCancellation({
    instanceId: instance.id,
    userId: customer.id,
    idempotencyKey: `phase6-cancel-request-${suffix}`,
    reason: "آزمون لغو کنترل‌شده بدون Provider",
  });
  assert.equal(requested.lifecycle, "CANCEL_REQUESTED");
  assert.equal(requested.refund, null);
  const expectedRefund = BigInt(requested.preview.refundableRial);
  assert.ok(expectedRefund > 0n && expectedRefund < order.amount);

  await prisma.resourceChangeRequest.update({
    where: { id: requested.requestId },
    data: {
      status: "APPROVED",
      approvedById: admin.id,
      approvedAt: new Date(),
    },
  });
  const first = await completeCancellationAfterTermination({
    resourceChangeRequestId: requested.requestId,
    actorUserId: admin.id,
    reason: "تأیید خاتمه کنترل‌شده در تست محلی",
  });
  const replay = await completeCancellationAfterTermination({
    resourceChangeRequestId: requested.requestId,
    actorUserId: admin.id,
    reason: "تأیید خاتمه کنترل‌شده در تست محلی",
  });
  assert.equal(first.reused, false);
  assert.equal(replay.reused, true);
  assert.equal(replay.ledgerEntryId, first.ledgerEntryId);
  assert.equal(BigInt(first.amountRial), expectedRefund);

  const [refreshedWallet, ledgerEntries, subscription, resource, change] =
    await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }),
      prisma.walletLedgerEntry.findMany({
        where: { idempotencyKey: `order_cancel_refund_${order.id}` },
      }),
      prisma.serviceSubscription.findUniqueOrThrow({
        where: { cloudInstanceId: instance.id },
      }),
      prisma.cloudInstance.findUniqueOrThrow({ where: { id: instance.id } }),
      prisma.resourceChangeRequest.findUniqueOrThrow({
        where: { id: requested.requestId },
      }),
    ]);
  assert.equal(ledgerEntries.length, 1);
  assert.equal(ledgerEntries[0]?.direction, "CREDIT");
  assert.equal(ledgerEntries[0]?.type, "REFUND");
  assert.equal(ledgerEntries[0]?.amount, expectedRefund);
  assert.equal(refreshedWallet.availableBalance, expectedRefund);
  assert.equal(subscription.status, "TERMINATED");
  assert.equal(resource.status, "TERMINATED");
  assert.equal(change.status, "APPLIED");
  assert.equal(
    await prisma.resourceVersion.count({
      where: {
        cloudInstanceId: instance.id,
        state: "TERMINATED",
        sourceChangeRequestId: change.id,
      },
    }),
    1,
  );
  assert.equal(
    await prisma.usageInterval.count({ where: { cloudInstanceId: instance.id } }),
    0,
  );
});
