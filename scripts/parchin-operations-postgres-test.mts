import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";

import { prisma } from "../lib/db.ts";
import { activateParchinEnrollmentTx } from "../lib/parchin/operations.ts";
import {
  createParchinReport,
  getCustomerParchinEnrollment,
  updateParchinTask,
} from "../lib/parchin/service.ts";
import {
  defaultParchinContractForLevel,
  snapshotParchinServiceContract,
} from "../lib/parchin/service-contract.ts";
import {
  adminUpdateSupportRequest,
  createSupportRequest,
} from "../lib/support/service.ts";
import { WalletError } from "../lib/wallet/errors.ts";

if (!process.env.DATABASE_URL || process.env.ABRCHIN_ISOLATED_TEST !== "1") {
  throw new Error("Parchin operations test requires isolated PostgreSQL");
}

after(async () => {
  await prisma.$disconnect();
});

function mobile(prefix: string) {
  return `${prefix}${randomBytes(4).readUInt32BE(0).toString().padStart(7, "0").slice(0, 7)}`;
}

test("Parchin Galaxy lifecycle enforces tasks, quota, P1 SLA and reports", async () => {
  const suffix = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000);
  const [customer, admin] = await Promise.all([
    prisma.user.create({
      data: { mobile: mobile("0912"), displayName: "مشتری پرچین" },
    }),
    prisma.user.create({
      data: { mobile: mobile("0935"), displayName: "اپراتور پرچین", role: "ADMIN" },
    }),
  ]);
  const contract = defaultParchinContractForLevel("PARCHIN_STABLE", {
    monthlyPriceRial: 50_000_000n,
    effectiveFrom: now,
  });
  const plan = await prisma.infrastructurePlan.create({
    data: {
      code: `PARCHIN_V3_${suffix}`,
      title: "Parchin v3 fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: `parchin-${suffix}`,
      sizeCode: "galaxy",
      imageCode: "ubuntu-24.04",
      deliveryMode: "MANAGED",
      vcpu: 8,
      ramGb: 16,
      storageGb: 160,
      salePriceRial: 100_000_000n,
      renewalPriceRial: 100_000_000n,
      estimatedProviderCostRial: 70_000_000n,
      minimumParchinLevel: "PARCHIN_STABLE",
      billingModel: "PREPAID_TERM",
    },
  });
  const order = await prisma.serviceOrder.create({
    data: {
      userId: customer.id,
      title: plan.title,
      amount: 100_000_000n,
      status: "PAID",
      planId: plan.id,
      planCode: plan.code,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: "PARCHIN_STABLE",
      parchinServiceSnapshot: snapshotParchinServiceContract(contract),
      paidAt: now,
    },
  });
  const infrastructure = await prisma.infrastructureOrder.create({
    data: {
      serviceOrderId: order.id,
      userId: customer.id,
      planId: plan.id,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      productKind: plan.productKind,
      parchinLevel: "PARCHIN_STABLE",
      deliveryMode: plan.deliveryMode,
      status: "ACTIVE",
      requiredFundingRial: 70_000_000n,
    },
  });
  const instance = await prisma.cloudInstance.create({
    data: {
      infrastructureOrderId: infrastructure.id,
      userId: customer.id,
      provider: plan.provider,
      providerApiVersion: plan.providerApiVersion,
      providerInstanceId: `parchin-resource-${suffix}`,
      name: `galaxy-${suffix}`,
      region: plan.regionCode,
      size: plan.sizeCode,
      image: plan.imageCode,
      deliveryMode: plan.deliveryMode,
      ipv4: "203.0.113.80",
      providerState: "active",
      status: "ACTIVE",
      deliveredAt: now,
    },
  });
  const subscription = await prisma.serviceSubscription.create({
    data: {
      cloudInstanceId: instance.id,
      sourceOrderId: order.id,
      userId: customer.id,
      planId: plan.id,
      status: "ACTIVE",
      parchinLevel: "PARCHIN_STABLE",
      renewalPriceRial: 100_000_000n,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      nextRenewalAt: periodEnd,
      graceEndsAt: new Date(periodEnd.getTime() + 7 * 24 * 60 * 60 * 1_000),
    },
  });

  const enrollment = await prisma.$transaction((tx) =>
    activateParchinEnrollmentTx(tx, {
      userId: customer.id,
      cloudInstanceId: instance.id,
      serviceOrderId: order.id,
      subscriptionId: subscription.id,
      level: "PARCHIN_STABLE",
      contractSnapshot: snapshotParchinServiceContract(contract),
      activatedAt: now,
      quotaPeriodStart: now,
      quotaPeriodEnd: periodEnd,
    }),
  );
  const tasks = await prisma.parchinTask.findMany({
    where: { enrollmentId: enrollment.id },
  });
  assert.equal(tasks.length, 13);

  for (let index = 0; index < 4; index += 1) {
    const request = await createSupportRequest({
      userId: customer.id,
      cloudInstanceId: instance.id,
      category: "CHANGE",
      kind: "ROUTINE",
      subject: `درخواست روتین ${index + 1}`,
      description: "تنظیم کنترل‌شده زیرساخت برای آزمون سهمیه پرچین.",
    });
    assert.equal(request.routineQuotaConsumed, true);
  }
  await assert.rejects(
    createSupportRequest({
      userId: customer.id,
      cloudInstanceId: instance.id,
      category: "CHANGE",
      kind: "ROUTINE",
      subject: "درخواست روتین پنجم",
      description: "این درخواست باید به دلیل پایان سهمیه رد شود.",
    }),
    (error) => error instanceof WalletError && error.code === "routine_quota_exhausted",
  );

  const p1 = await createSupportRequest({
    userId: customer.id,
    cloudInstanceId: instance.id,
    category: "OTHER",
    kind: "P1_INCIDENT",
    subject: "قطعی کامل سرویس Production",
    description: "سرویس Production از دسترس خارج شده و نیازمند رسیدگی فوری است.",
  });
  assert.equal(p1.priority, "URGENT");
  assert.ok(p1.firstResponseDueAt);
  const p1Task = await prisma.parchinTask.findFirstOrThrow({
    where: { enrollmentId: enrollment.id, type: "INCIDENT_RESPONSE" },
  });
  assert.equal(p1Task.priority, "CRITICAL");
  assert.equal(p1Task.dueAt.toISOString(), p1.firstResponseDueAt?.toISOString());

  const responded = await adminUpdateSupportRequest({
    adminUserId: admin.id,
    requestId: p1.id,
    assignedToId: admin.id,
    status: "IN_PROGRESS",
    reply: "رخداد دریافت شد؛ بررسی و مهار اولیه آغاز شده است.",
  });
  assert.ok(responded.firstRespondedAt);
  assert.equal(responded.assignedToId, admin.id);

  const daily = tasks.find((task) => task.type === "DAILY_BACKUP");
  assert.ok(daily);
  await updateParchinTask({
    taskId: daily!.id,
    adminUserId: admin.id,
    assignedToId: admin.id,
    status: "COMPLETED",
    evidenceSummary: "بکاپ روزانه موفق بود و نسخه در مخزن کنترل شد.",
  });
  assert.equal(
    await prisma.parchinTask.count({
      where: { enrollmentId: enrollment.id, type: "DAILY_BACKUP" },
    }),
    2,
  );

  const report = await createParchinReport({
    enrollmentId: enrollment.id,
    adminUserId: admin.id,
    type: "OPERATIONS",
    title: "گزارش عملیات ماهانه",
    summary: "پایش، بکاپ و منابع در بازه گزارش پایدار و بدون رخداد حل‌نشده بودند.",
    periodStart: now,
    periodEnd: new Date(),
    metrics: {
      uptimePercent: 99.98,
      cpuAveragePercent: 32,
      ramPeakPercent: 61,
      diskUsedPercent: 44,
      backupStatus: "موفق",
      patchStatus: "به‌روز",
      restoreStatus: "آزمون موفق",
    },
    recommendations: ["بازبینی ظرفیت در دوره بعد"],
    publish: true,
  });
  assert.equal(report.status, "PUBLISHED");
  const customerView = await getCustomerParchinEnrollment(customer.id, enrollment.id);
  assert.equal(customerView.reports.length, 1);
  assert.deepEqual(customerView.reports[0]?.metrics, {
    uptimePercent: 99.98,
    cpuAveragePercent: 32,
    ramPeakPercent: 61,
    diskUsedPercent: 44,
    backupStatus: "موفق",
    patchStatus: "به‌روز",
    restoreStatus: "آزمون موفق",
  });
});
