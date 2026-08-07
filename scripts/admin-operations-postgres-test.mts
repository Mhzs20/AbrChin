import assert from "node:assert/strict";
import test from "node:test";

import { UserRole } from "@prisma/client";

import { listAdminOperationsQueues } from "../lib/admin/operations.ts";
import {
  approveResourceChangeRequest,
  markProviderBillingReconciliationForReview,
} from "../lib/billing/admin-review.ts";
import { approveControlledSuspensionRequest } from "../lib/billing/dunning.ts";
import { prisma as db } from "../lib/db.ts";

test("all Admin Operations queues use disjoint eligible predicates and controlled actions", async (t) => {
  if (
    process.env.ABRCHIN_ISOLATED_TEST !== "1" ||
    !process.env.DATABASE_URL
  ) {
    t.skip("requires isolated PostgreSQL");
    return;
  }
  const suffix = Date.now().toString(36);
  const now = new Date();
  const [customer, admin] = await Promise.all([
    db.user.create({
      data: { mobile: `0931${suffix.slice(-7).padStart(7, "0")}` },
    }),
    db.user.create({
      data: {
        mobile: `0932${suffix.slice(-7).padStart(7, "0")}`,
        role: UserRole.ADMIN,
      },
    }),
  ]);
  const wallet = await db.wallet.create({
    data: { userId: customer.id, availableBalance: 2_000_000n },
  });
  const policy = await db.billingPolicyVersion.create({
    data: {
      policyKey: `ops-${suffix}`,
      version: 1,
      scope: "GLOBAL",
      availability: "HOURLY_AND_DAILY",
      defaultCadence: "HOURLY",
      displayMode: "BOTH",
      calculationUnit: "SECOND",
      roundingPolicy: "EXACT",
      stopStateComponentPolicy: {
        compute: "PROVIDER_POLICY",
        disk: "BILLABLE",
        ip: "BILLABLE",
      },
      enabledCadences: ["HOURLY", "DAILY"],
      effectiveFrom: new Date(now.getTime() - 60_000),
      changeReason: "operations fixture",
    },
  });
  const plan = await db.infrastructurePlan.create({
    data: {
      code: `OPS-${suffix}`,
      title: "Operations PAYG fixture",
      provider: "ARVAN",
      providerApiVersion: "v1",
      productKind: "CLOUD_SERVER",
      regionCode: "ir-thr-ba1",
      sizeCode: `ops-${suffix}`,
      imageCode: "ubuntu-24",
      deliveryMode: "MANAGED",
      vcpu: 2,
      ramGb: 4,
      storageGb: 50,
      salePriceRial: 0n,
      estimatedProviderCostRial: 10_000n,
      parchinIncluded: true,
      minimumParchinLevel: "PARCHIN_START",
      active: true,
      publicationStatus: "PUBLISHED",
      offerSource: "MANUAL_ADMIN",
      offerLastVerifiedAt: now,
      offerPriceValidUntil: new Date(now.getTime() + 3_600_000),
      billingModel: "PAYG_WALLET",
      billingPolicyVersionId: policy.id,
    },
  });
  const makeOrder = (label: string, state: string) =>
    db.serviceOrder.create({
      data: {
        userId: customer.id,
        title: `${label} ${suffix}`,
        amount: 0n,
        status: "ACTIVATION_REQUESTED",
        planId: plan.id,
        planCode: plan.code,
        planSnapshot: {},
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        productFlowState: state,
      },
    });
  const [
    activationOrder,
    failedOrder,
    deliveryOrder,
    activeDeliveryOrder,
    fundingConfirmedOrder,
  ] = await Promise.all([
    makeOrder("activation", "ACTIVATION_REQUESTED"),
    makeOrder("failed", "PROVISIONING_RETRYABLE"),
    makeOrder("delivery", "WAITING_ADMIN_DELIVERY_APPROVAL"),
    makeOrder("active-delivery", "DELIVERED"),
    makeOrder("funding-confirmed", "PROVISION_APPROVED"),
  ]);
  const activation = await db.activationRequest.create({
    data: {
      userId: customer.id,
      serviceOrderId: activationOrder.id,
      planId: plan.id,
      billingPolicyVersionId: policy.id,
      selectedCadence: "HOURLY",
      status: "WAITING_ADMIN_APPROVAL",
      estimatedHourlyRial: 12_500n,
      estimatedDailyRial: 300_000n,
      minimumCreditRequiredRial: 300_000n,
      estimateSnapshot: {},
      idempotencyKey: `activation-${suffix}`,
    },
  });
  const createInfrastructure = (
    serviceOrderId: string,
    status:
      | "FAILED"
      | "PROVISIONING"
      | "ACTIVE"
      | "FUNDING_CONFIRMED",
    productFlowState: string,
  ) =>
    db.infrastructureOrder.create({
      data: {
        serviceOrderId,
        userId: customer.id,
        planId: plan.id,
        provider: "ARVAN",
        productKind: "CLOUD_SERVER",
        deliveryMode: "MANAGED",
        status,
        requiredFundingRial: 0n,
        productFlowState,
        providerSelectionSnapshot: {},
      },
    });
  const [failed, delivery, activeDelivery, fundingConfirmed] =
    await Promise.all([
      createInfrastructure(
        failedOrder.id,
        "FAILED",
        "PROVISIONING_RETRYABLE",
      ),
      createInfrastructure(
        deliveryOrder.id,
        "PROVISIONING",
        "WAITING_ADMIN_DELIVERY_APPROVAL",
      ),
      createInfrastructure(
        activeDeliveryOrder.id,
        "ACTIVE",
        "DELIVERED",
      ),
      createInfrastructure(
        fundingConfirmedOrder.id,
        "FUNDING_CONFIRMED",
        "PROVISION_APPROVED",
      ),
    ]);
  const instance = await db.cloudInstance.create({
    data: {
      infrastructureOrderId: delivery.id,
      userId: customer.id,
      provider: "ARVAN",
      providerInstanceId: `ops-instance-${suffix}`,
      name: `ops-${suffix}`,
      region: plan.regionCode,
      size: plan.sizeCode,
      image: plan.imageCode,
      deliveryMode: "MANAGED",
      providerState: "active",
      providerObservedAt: now,
      status: "PENDING",
    },
  });
  const resourceVersion = await db.resourceVersion.create({
    data: {
      cloudInstanceId: instance.id,
      planId: plan.id,
      provider: "ARVAN",
      providerInstanceId: instance.providerInstanceId,
      state: "ACTIVE",
      vcpu: 2,
      ramMb: 4096,
      diskGb: 50,
      resourceSnapshot: { source: "controlled-test" },
      providerConfirmedAt: now,
      effectiveFrom: now,
      idempotencyKey: `resource-version-${suffix}`,
    },
  });
  const resourceChange = await db.resourceChangeRequest.create({
    data: {
      cloudInstanceId: instance.id,
      planId: plan.id,
      requestedById: customer.id,
      sourceResourceVersionId: resourceVersion.id,
      requestedResources: { vcpu: 1, ramMb: 2048, direction: "DOWNGRADE" },
      estimateSnapshot: { dailyEstimateRial: "150000" },
      incrementalBufferRial: 0n,
      status: "WAITING_ADMIN_APPROVAL",
      idempotencyKey: `resource-change-${suffix}`,
    },
  });
  const snapshot = await db.serviceBillingPolicySnapshot.create({
    data: {
      cloudInstanceId: instance.id,
      billingPolicyVersionId: policy.id,
      cadence: "HOURLY",
      displayMode: "BOTH",
      calculationUnit: "SECOND",
      minimumChargeSeconds: 0,
      roundingPolicy: "EXACT",
      prorationSupported: true,
      hourlyEstimateRial: 12_500n,
      dailyEstimateRial: 300_000n,
      minimumCreditRial: 300_000n,
      gracePeriods: 24,
      lowBalanceThresholdPeriods: 3,
      stopStateComponentPolicy: { disk: "BILLABLE", ip: "BILLABLE" },
      providerPolicySnapshot: { status: "UNVERIFIED" },
      effectiveFrom: now,
      idempotencyKey: `policy-snapshot-${suffix}`,
    },
  });
  const run = await db.billingRun.create({
    data: {
      cadence: "HOURLY",
      periodStart: new Date(now.getTime() - 3_600_000),
      periodEnd: now,
      status: "COMPLETED",
      workerId: "controlled-test",
      idempotencyKey: `billing-run-${suffix}`,
    },
  });
  const invoice = await db.billingInvoice.create({
    data: {
      billingRunId: run.id,
      userId: customer.id,
      walletId: wallet.id,
      cloudInstanceId: instance.id,
      billingPolicySnapshotId: snapshot.id,
      cadence: "HOURLY",
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: "PARTIALLY_PAID",
      totalAmountRial: 100_000n,
      paidAmountRial: 40_000n,
      outstandingAmountRial: 60_000n,
      finalizedAt: now,
      idempotencyKey: `invoice-${suffix}`,
    },
  });
  const [lowBalance, suspension] = await Promise.all([
    db.dunningCase.create({
      data: {
        cloudInstanceId: instance.id,
        billingInvoiceId: invoice.id,
        type: "LOW_BALANCE",
        status: "NOTIFIED",
        thresholdRial: 300_000n,
        observedBalanceRial: 50_000n,
        runwaySeconds: 14_400n,
        idempotencyKey: `low-balance-${suffix}`,
      },
    }),
    db.dunningCase.create({
      data: {
        cloudInstanceId: instance.id,
        billingInvoiceId: invoice.id,
        type: "SUSPENSION_REVIEW",
        status: "ADMIN_REVIEW",
        thresholdRial: 0n,
        observedBalanceRial: 0n,
        idempotencyKey: `suspension-${suffix}`,
      },
    }),
  ]);
  const reconciliation = await db.billingReconciliation.create({
    data: {
      provider: "ARVAN",
      kind: "PROVIDER_INVOICE",
      status: "MISMATCH",
      cloudInstanceId: instance.id,
      billingInvoiceId: invoice.id,
      internalAmountRial: 100_000n,
      normalizedProviderRial: 110_000n,
      differenceRial: 10_000n,
      reason: "controlled mismatch",
      idempotencyKey: `reconciliation-${suffix}`,
    },
  });
  const topUp = await db.walletTopUp.create({
    data: {
      walletId: wallet.id,
      amount: 500_000n,
      gateway: "MOCK",
      status: "SUCCEEDED",
      idempotencyKey: `topup-${suffix}`,
      callbackTokenHash: `callback-${suffix}`,
      expiresAt: new Date(now.getTime() + 60_000),
      verifiedAt: now,
    },
  });
  const [openAttempt, reconcilingAttempt] = await Promise.all([
    db.paymentAttempt.create({
      data: {
        walletTopUpId: topUp.id,
        attemptNumber: 1,
        amount: topUp.amount,
        gateway: "MOCK",
        status: "REVIEW",
        callbackTokenHash: `attempt-open-${suffix}`,
        expiresAt: new Date(now.getTime() + 60_000),
        idempotencyKey: `attempt-open-${suffix}`,
      },
    }),
    db.paymentAttempt.create({
      data: {
        walletTopUpId: topUp.id,
        attemptNumber: 2,
        amount: topUp.amount,
        gateway: "MOCK",
        status: "SUCCEEDED",
        callbackTokenHash: `attempt-reconcile-${suffix}`,
        expiresAt: new Date(now.getTime() + 60_000),
        idempotencyKey: `attempt-reconcile-${suffix}`,
      },
    }),
  ]);
  const [paymentReview, creditReconciliation] = await Promise.all([
    db.paymentRecoveryCase.create({
      data: {
        walletTopUpId: topUp.id,
        attemptId: openAttempt.id,
        status: "OPEN",
        reasonCode: "amount_mismatch",
        safeMessage: "مبلغ نیازمند بررسی است.",
        expectedAmount: topUp.amount,
        observedAmount: topUp.amount + 1n,
      },
    }),
    db.paymentRecoveryCase.create({
      data: {
        walletTopUpId: topUp.id,
        attemptId: reconcilingAttempt.id,
        status: "RECONCILING",
        reasonCode: "credit_transaction_failed",
        safeMessage: "Credit باید بازیابی شود.",
        expectedAmount: topUp.amount,
        observedAmount: topUp.amount,
      },
    }),
  ]);
  const refund = await db.walletTopUpRefund.create({
    data: {
      walletTopUpId: topUp.id,
      requestedById: admin.id,
      amount: 100_000n,
      status: "REVIEW_REQUIRED",
      reason: "controlled review fixture",
      idempotencyKey: `refund-${suffix}`,
    },
  });
  await db.serviceConnectionCheck.upsert({
    where: { service: "ARVAN" },
    create: {
      service: "ARVAN",
      configured: true,
      status: "ERROR",
      capabilities: [],
      errorCode: "invalid_api_key",
      message: "کلید دسترسی پذیرفته نشد.",
    },
    update: {
      configured: true,
      status: "ERROR",
      capabilities: [],
      errorCode: "invalid_api_key",
      message: "کلید دسترسی پذیرفته نشد.",
      checkedAt: now,
    },
  });

  const queues = await listAdminOperationsQueues();
  const items = (key: (typeof queues)[number]["key"]) =>
    queues.find((queue) => queue.key === key)?.items ?? [];
  assert.deepEqual(
    new Set(queues.map((queue) => queue.key)).size,
    13,
  );
  assert.equal(items("walletPaymentReview")[0]?.id, paymentReview.id);
  assert.equal(
    items("walletCreditReconciliation")[0]?.id,
    creditReconciliation.id,
  );
  assert.equal(items("activationApproval")[0]?.id, activation.id);
  assert.equal(items("provisionRecovery")[0]?.id, failed.id);
  assert.equal(
    items("provisionRecovery").some(
      (item) => item.id === fundingConfirmed.id,
    ),
    false,
  );
  assert.equal(items("resourceChangeApproval")[0]?.id, resourceChange.id);
  assert.equal(items("deliveryApproval")[0]?.id, delivery.id);
  assert.equal(
    items("deliveryApproval").some(
      (item) => item.id === activeDelivery.id,
    ),
    false,
  );
  assert.equal(items("lowBalance")[0]?.id, lowBalance.id);
  assert.equal(items("unpaidInvoice")[0]?.id, invoice.id);
  assert.equal(items("suspensionReview")[0]?.id, suspension.id);
  assert.equal(
    items("providerBillingReconciliation")[0]?.id,
    reconciliation.id,
  );
  assert.equal(items("controlledRefund")[0]?.id, refund.id);
  assert.equal(items("connectionFailure")[0]?.id, "ARVAN");
  for (const queue of queues) {
    for (const item of queue.items) {
      assert.ok(item.action.label.length > 0);
      assert.ok(
        item.action.kind !== "link" || Boolean(item.action.href),
        `${queue.key} has a real action`,
      );
    }
  }

  const approvedChange = await approveResourceChangeRequest({
    resourceChangeRequestId: resourceChange.id,
    actorUserId: admin.id,
    reason: "تأیید Downgrade بدون Mutation Provider",
    idempotencyKey: `approve-change-${suffix}`,
  });
  const approvedChangeReplay = await approveResourceChangeRequest({
    resourceChangeRequestId: resourceChange.id,
    actorUserId: admin.id,
    reason: "تأیید Downgrade بدون Mutation Provider",
    idempotencyKey: `approve-change-${suffix}`,
  });
  assert.deepEqual(approvedChangeReplay, approvedChange);
  assert.equal(approvedChange.providerMutationExecuted, false);

  const reviewed = await markProviderBillingReconciliationForReview({
    billingReconciliationId: reconciliation.id,
    actorUserId: admin.id,
    reason: "ورود کنترل‌شده اختلاف Provider به Review",
    idempotencyKey: `review-reconciliation-${suffix}`,
  });
  const reviewReplay = await markProviderBillingReconciliationForReview({
    billingReconciliationId: reconciliation.id,
    actorUserId: admin.id,
    reason: "ورود کنترل‌شده اختلاف Provider به Review",
    idempotencyKey: `review-reconciliation-${suffix}`,
  });
  assert.deepEqual(reviewReplay, reviewed);
  assert.equal(reviewed.walletChanged, false);

  const suspended = await approveControlledSuspensionRequest({
    dunningCaseId: suspension.id,
    actorUserId: admin.id,
    reason: "تأیید کنترل‌شده درخواست Suspend بدون اجرا",
    idempotencyKey: `approve-suspension-${suffix}`,
  });
  const suspensionReplay = await approveControlledSuspensionRequest({
    dunningCaseId: suspension.id,
    actorUserId: admin.id,
    reason: "تأیید کنترل‌شده درخواست Suspend بدون اجرا",
    idempotencyKey: `approve-suspension-${suffix}`,
  });
  assert.deepEqual(suspensionReplay, suspended);
  assert.equal(suspended.providerMutationExecuted, false);
  assert.equal(suspended.automaticTermination, false);
  assert.equal(
    await db.auditLog.count({
      where: {
        action: {
          in: [
            "resource_change_approved",
            "provider_billing_review",
            "controlled_suspension_approved",
          ],
        },
      },
    }),
    3,
  );
  await db.$disconnect();
});
