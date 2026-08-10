import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { PrismaClient, UserRole } from "@prisma/client";

import { approveDelivery } from "../lib/infrastructure/delivery-approval.ts";
import {
  InstanceCredentialError,
  revealInstanceCredential,
} from "../lib/security/instance-credentials.ts";
import { encryptCredential } from "../lib/security/credential-vault.ts";
import {
  defaultParchinContractForLevel,
  snapshotParchinServiceContract,
} from "../lib/parchin/service-contract.ts";
import { allowAdminMobile } from "./test-admin-allowlist.mts";

const db =
  process.env.ABRCHIN_ISOLATED_TEST === "1" && process.env.DATABASE_URL
    ? new PrismaClient()
    : null;

test("retryable delivery, concurrent approval and atomic one-time reveal", async (t) => {
  if (!db) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const suffix = Date.now().toString(36);
  const adminMobile = `0913${suffix.slice(-7).padStart(7, "0")}`;
  const restoreAllowlist = allowAdminMobile(adminMobile);
  t.after(restoreAllowlist);
  const [customer, otherCustomer, admin] = await Promise.all([
    db.user.create({ data: { mobile: `0911${suffix.slice(-7).padStart(7, "0")}` } }),
    db.user.create({ data: { mobile: `0912${suffix.slice(-7).padStart(7, "0")}` } }),
    db.user.create({
      data: {
        mobile: adminMobile,
        role: UserRole.ADMIN,
      },
    }),
  ]);
  const plan = await db.infrastructurePlan.create({
    data: {
      code: `DELIVERY-${suffix}`,
      title: "Delivery fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      regionCode: `ir-${suffix}`,
      sizeCode: `size-${suffix}`,
      imageCode: "ubuntu-24",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 500_000n,
      renewalPriceRial: 500_000n,
      estimatedProviderCostRial: 400_000n,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      offerSource: "MANUAL_ADMIN",
      offerLastVerifiedAt: new Date(),
      offerPriceValidUntil: new Date(Date.now() + 3_600_000),
      billingModel: "PREPAID_TERM",
    },
  });
  const serviceOrder = await db.serviceOrder.create({
    data: {
      userId: customer.id,
      title: plan.title,
      amount: 500_000n,
      status: "PAID",
      paidAt: new Date(),
      planId: plan.id,
      planCode: plan.code,
      planSnapshot: { finalPriceRialSnapshot: "500000" },
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      parchinLevel: "PARCHIN_START",
      parchinServiceSnapshot: snapshotParchinServiceContract(
        defaultParchinContractForLevel("PARCHIN_START", {
          monthlyPriceRial: 5_000_000n,
        }),
      ),
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
    },
  });
  const deliveryConfiguration = {
    provider: "ARVAN",
    providerApiVersion: "v1",
    productKind: "READY_INSTANT_SERVER",
    region: plan.regionCode,
    externalPlanId: plan.sizeCode,
    externalImageId: plan.imageCode,
    externalNetworkId: "network-1",
    externalSecurityId: "security-1",
    topologyVerificationMode: "STRICT_OBSERVED",
    accessMethod: "ONE_TIME_PASSWORD",
  };
  const infrastructure = await db.infrastructureOrder.create({
    data: {
      serviceOrderId: serviceOrder.id,
      userId: customer.id,
      planId: plan.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "READY_INSTANT_SERVER",
      deliveryMode: "MANAGED",
      status: "PROVISIONING",
      requiredFundingRial: 0n,
      productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
      providerSelectionSnapshot: {
        ...deliveryConfiguration,
        deliveryConfiguration,
      },
    },
  });
  const observedAt = new Date();
  const instance = await db.cloudInstance.create({
    data: {
      infrastructureOrderId: infrastructure.id,
      userId: customer.id,
      provider: "ARVAN",
      providerApiVersion: "v1",
      providerInstanceId: `resource-${suffix}`,
      name: `delivery-${suffix}`,
      region: plan.regionCode,
      size: plan.sizeCode,
      image: plan.imageCode,
      deliveryMode: "MANAGED",
      ipv4: "192.0.2.20",
      providerState: "active",
      networkId: "network-1",
      securityId: "security-1",
      providerObservedAt: observedAt,
      status: "PENDING",
      healthCheckedAt: observedAt,
    },
  });
  const health = await db.infrastructureHealthCheck.create({
    data: {
      infrastructureOrderId: infrastructure.id,
      cloudInstanceId: instance.id,
      attempt: 1,
      status: "FAILED",
      resultCode: "temporary_probe_failure",
      checkedAt: observedAt,
      finishedAt: observedAt,
    },
  });
  const secret = `temporary-${suffix}-credential`;
  await db.instanceCredential.create({
    data: {
      cloudInstanceId: instance.id,
      createdById: admin.id,
      username: "root",
      ...encryptCredential(secret),
      status: "READY",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  await db.secureDeliveryEvent.create({
    data: {
      infrastructureOrderId: infrastructure.id,
      cloudInstanceId: instance.id,
      status: "PENDING",
      method: "ONE_TIME_ENCRYPTED_CREDENTIAL",
      resultCode: "waiting_admin_delivery_approval",
      metadata: { containsSecret: false },
    },
  });

  await assert.rejects(
    revealInstanceCredential({
      instanceId: instance.id,
      userId: customer.id,
    }),
    (error) =>
      error instanceof InstanceCredentialError &&
      error.code === "not_found",
  );
  const retryable = await approveDelivery({
    infrastructureOrderId: infrastructure.id,
    adminUserId: admin.id,
    reason: "بررسی تحویل کنترل‌شده",
    idempotencyKey: `delivery-approve-${suffix}`,
  });
  assert.equal(retryable.approved, false);
  assert.equal("retryable" in retryable && retryable.retryable, true);
  assert.equal(
    await db.adminCommandReceipt.count({
      where: {
        infrastructureOrderId: infrastructure.id,
        operation: "APPROVE_DELIVERY",
      },
    }),
    0,
  );
  await db.infrastructureHealthCheck.update({
    where: { id: health.id },
    data: {
      status: "SUCCEEDED",
      resultCode: "healthy",
    },
  });
  const [approvalA, approvalB] = await Promise.all([
    approveDelivery({
      infrastructureOrderId: infrastructure.id,
      adminUserId: admin.id,
      reason: "بررسی تحویل کنترل‌شده",
      idempotencyKey: `delivery-approve-${suffix}`,
    }),
    approveDelivery({
      infrastructureOrderId: infrastructure.id,
      adminUserId: admin.id,
      reason: "بررسی تحویل کنترل‌شده",
      idempotencyKey: `delivery-approve-${suffix}`,
    }),
  ]);
  assert.deepEqual(approvalA, approvalB);
  assert.equal(approvalA.approved, true);
  assert.equal(
    await db.secureDeliveryEvent.count({
      where: {
        infrastructureOrderId: infrastructure.id,
        status: "DELIVERED",
      },
    }),
    1,
  );
  assert.equal(
    await db.provisioningNotificationOutbox.count({
      where: { idempotencyKey: `instance-active:${infrastructure.id}` },
    }),
    1,
  );
  const enrollment = await db.parchinEnrollment.findUniqueOrThrow({
    where: { cloudInstanceId: instance.id },
    include: { tasks: true },
  });
  assert.equal(enrollment.level, "PARCHIN_START");
  assert.equal(enrollment.contractVersion, 3);
  assert.equal(enrollment.routineRequestLimit, 1);
  assert.equal(enrollment.tasks.length, 4);
  assert.ok(
    enrollment.tasks.some((task) => task.type === "INITIAL_HARDENING"),
  );
  assert.ok(enrollment.tasks.some((task) => task.type === "HEALTH_REPORT"));
  await assert.rejects(
    revealInstanceCredential({
      instanceId: instance.id,
      userId: otherCustomer.id,
    }),
    (error) =>
      error instanceof InstanceCredentialError &&
      error.code === "not_found",
  );
  await assert.rejects(
    revealInstanceCredential({
      instanceId: instance.id,
      userId: customer.id,
      testInjectFailureAfterAudit: true,
    }),
    /test_injected_after_credential_audit/,
  );
  const afterRollback = await db.instanceCredential.findUniqueOrThrow({
    where: { cloudInstanceId: instance.id },
  });
  assert.equal(afterRollback.status, "READY");
  assert.ok(afterRollback.ciphertext);
  assert.equal(
    await db.auditLog.count({
      where: {
        action: "credential_revealed",
        entityId: instance.id,
      },
    }),
    0,
  );
  const reveals = await Promise.allSettled([
    revealInstanceCredential({
      instanceId: instance.id,
      userId: customer.id,
    }),
    revealInstanceCredential({
      instanceId: instance.id,
      userId: customer.id,
    }),
  ]);
  const successful = reveals.filter(
    (result): result is PromiseFulfilledResult<{
      username: string;
      secret: string;
      ipv4: string | null;
    }> => result.status === "fulfilled",
  );
  assert.equal(successful.length, 1);
  assert.equal(successful[0].value.secret, secret);
  const consumed = await db.instanceCredential.findUniqueOrThrow({
    where: { cloudInstanceId: instance.id },
  });
  assert.equal(consumed.status, "REVEALED");
  assert.equal(consumed.ciphertext, null);
  const audit = await db.auditLog.findFirstOrThrow({
    where: {
      action: "credential_revealed",
      entityId: instance.id,
    },
  });
  assert.equal(JSON.stringify(audit).includes(secret), false);
  await db.$disconnect();
});
