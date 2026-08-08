import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { computePrepaidCancellationPreview } from "../lib/orders/prepaid-cancellation.ts";

test("prepaid cancel preview uses straight-line recognition and exact refund math", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  // Exactly 25% through a 1-month (30-day) term.
  const asOf = new Date(start.getTime() + 7.5 * 24 * 60 * 60 * 1000);
  const preview = computePrepaidCancellationPreview({
    originalPaidRial: 80_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf,
    walletBalanceRial: 10_000_000n,
  });
  assert.equal(preview.originalPaidRial, 80_000_000n);
  assert.equal(preview.consumedRial, 20_000_000n);
  assert.equal(preview.nonRefundableRial, 0n);
  assert.equal(preview.refundableRial, 60_000_000n);
  assert.equal(preview.walletBalanceAfterRefundRial, 70_000_000n);
});

test("fully elapsed prepaid term refunds zero and keeps original paid immutable", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const asOf = new Date(start.getTime() + 40 * 24 * 60 * 60 * 1000);
  const preview = computePrepaidCancellationPreview({
    originalPaidRial: 8_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf,
    walletBalanceRial: 0n,
  });
  assert.equal(preview.consumedRial, 8_000_000n);
  assert.equal(preview.refundableRial, 0n);
  assert.equal(preview.walletBalanceAfterRefundRial, 0n);
});

test("policy-defined non-refundable amount reduces refundable base only", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const preview = computePrepaidCancellationPreview({
    originalPaidRial: 10_000_000n,
    termMonths: 1,
    serviceStartedAt: start,
    asOf: start,
    nonRefundableRial: 1_000_000n,
    walletBalanceRial: 0n,
  });
  assert.equal(preview.consumedRial, 0n);
  assert.equal(preview.nonRefundableRial, 1_000_000n);
  assert.equal(preview.refundableRial, 9_000_000n);
});

test("cancel UX and lifecycle wiring stay wallet-only and idempotent", async () => {
  const cancelService = await readFile(
    "lib/orders/customer-cancel-service.ts",
    "utf8",
  );
  const panel = await readFile(
    "components/account/service-cancel-panel.tsx",
    "utf8",
  );
  const route = await readFile(
    "app/api/account/instances/[id]/cancel/route.ts",
    "utf8",
  );
  const fulfill = await readFile(
    "app/api/admin/resource-changes/[id]/fulfill-manually/route.ts",
    "utf8",
  );
  const posting = await readFile("lib/accounting/posting.ts", "utf8");
  const changeButtons = await readFile(
    "components/account/service-change-request-buttons.tsx",
    "utf8",
  );

  assert.match(cancelService, /CANCEL_REQUESTED/);
  assert.match(cancelService, /TERMINATING/);
  assert.match(cancelService, /TERMINATED/);
  assert.match(cancelService, /REFUND_CREDITED/);
  assert.match(cancelService, /TERMINATION_FAILED/);
  assert.match(cancelService, /order_cancel_refund_/);
  assert.match(cancelService, /payg_cancel_not_supported/);
  assert.match(cancelService, /LedgerType\.REFUND/);
  assert.match(cancelService, /completeCancellationAfterTermination/);
  assert.doesNotMatch(cancelService, /createOrderPaymentIntent|\/payment/);
  // Cancel REQUEST must not mark subscription CANCELED before provider
  // termination is confirmed (CANCELED would falsely look terminated).
  assert.doesNotMatch(
    cancelService,
    /status:\s*SubscriptionStatus\.CANCELED/,
  );
  assert.match(cancelService, /autoRenew:\s*false/);
  assert.match(
    cancelService,
    /status:\s*SubscriptionStatus\.TERMINATED/,
  );

  assert.match(panel, /لغو سرویس و بازگشت/);
  assert.match(panel, /اعتبار خرید/);
  assert.match(panel, /مصرف‌شده/);
  assert.match(panel, /مبلغ قابل بازگشت/);
  assert.match(panel, /سرویس لغو شد/);
  assert.match(panel, /account\/transactions/);

  assert.match(route, /previewCustomerServiceCancellation/);
  assert.match(route, /requestCustomerServiceCancellation/);
  assert.match(route, /Idempotency-Key/);

  assert.match(fulfill, /completeCancellationAfterTermination/);
  assert.match(posting, /postPrepaidCancellationRefund/);
  assert.match(posting, /SALES_REFUND/);
  assert.match(posting, /CUSTOMER_WALLET_LIABILITY/);

  assert.doesNotMatch(changeButtons, /درخواست حذف/);
  assert.match(changeButtons, /لغو سرویس/);
});

test("cancel request keeps subscription active until provider termination confirms", async (t) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const {
    CloudInstanceStatus,
    DeliveryMode,
    InfrastructureOrderStatus,
    PrismaClient,
    ProductBillingModel,
    ServiceOrderStatus,
    SubscriptionStatus,
  } = await import("@prisma/client");
  const { requestCustomerServiceCancellation } = await import(
    "../lib/orders/customer-cancel-service.ts"
  );

  const prisma = new PrismaClient();
  const suffix = Date.now().toString(36);
  const mobile = `0912${suffix.slice(-7).padStart(7, "0")}`.slice(0, 11);
  const previous = {
    arvanEnabled: process.env.ARVAN_ENABLED,
    arvanKey: process.env.ARVAN_API_KEY,
    arvanMutations: process.env.ARVAN_MUTATIONS_ENABLED,
  };

  let userId = "";
  let planId = "";
  let catalogItemId = "";
  let orderId = "";
  let instanceId = "";

  try {
    const user = await prisma.user.create({
      data: {
        mobile,
        role: "CUSTOMER",
        accountStatus: "ACTIVE",
        mobileVerifiedAt: new Date(),
        registrationCompletedAt: new Date(),
        displayName: "Cancel Lifecycle",
      },
    });
    userId = user.id;

    await prisma.wallet.create({
      data: {
        userId: user.id,
        availableBalance: 0n,
        status: "ACTIVE",
      },
    });

    const catalog = await prisma.providerCatalogItem.create({
      data: {
        provider: "ARVAN",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        regionCode: `cancel-${suffix}`,
        sizeCode: "g1-1-1-0",
        externalPlanId: `cancel-plan-${suffix}`,
        externalKey: `arvan:v1:cancel-${suffix}:g1-1-1-0`,
        sizeName: "Cancel Catalog",
        compatibleImageCodes: ["ubuntu-22.04"],
        vcpu: 1,
        ramMb: 1024,
        diskGb: 25,
        available: true,
        active: true,
        status: "ACTIVE",
        priceMonthlyAmount: 10_000_000n,
        priceScale: 0,
        currencyCode: "IRR",
        amountUnit: "RIAL",
        providerMonthlyPriceIrr: 5_000_000n,
        lastSyncedAt: new Date(),
        lastSeenAt: new Date(),
        rawPayload: {},
        payloadHash: `cancel-${suffix}`,
      },
    });
    catalogItemId = catalog.id;

    const plan = await prisma.infrastructurePlan.create({
      data: {
        code: `CANCEL_PLAN_${suffix}`,
        title: "Cancel Plan",
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        regionCode: "ir-thr-si1",
        sizeCode: "g1-1-1-0",
        imageCode: "ubuntu-22.04",
        deliveryMode: DeliveryMode.MANAGED,
        vcpu: 1,
        ramGb: 1,
        storageGb: 25,
        salePriceRial: 10_000_000n,
        renewalPriceRial: 10_000_000n,
        estimatedProviderCostRial: 5_000_000n,
        active: true,
        publicationStatus: "PUBLISHED",
        billingModel: ProductBillingModel.PREPAID_TERM,
        catalogItemId: catalog.id,
        catalogMappingStatus: "MAPPED",
      },
    });
    planId = plan.id;

    const paidAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);

    const order = await prisma.serviceOrder.create({
      data: {
        userId: user.id,
        title: "Cancel lifecycle order",
        description: "cancel regression",
        amount: 10_000_000n,
        termMonths: 1,
        status: ServiceOrderStatus.PAID,
        planId: plan.id,
        planCode: plan.code,
        paidAt,
        productFlowState: "ACTIVE",
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
      },
    });
    orderId = order.id;

    const infra = await prisma.infrastructureOrder.create({
      data: {
        serviceOrderId: order.id,
        userId: user.id,
        planId: plan.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        deliveryMode: DeliveryMode.MANAGED,
        status: InfrastructureOrderStatus.ACTIVE,
        requiredFundingRial: 10_000_000n,
        desiredInstanceName: `cancel-${suffix}`,
        productFlowState: "ACTIVE",
      },
    });

    const instance = await prisma.cloudInstance.create({
      data: {
        infrastructureOrderId: infra.id,
        userId: user.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        providerInstanceId: `arvan-cancel-${suffix}`,
        name: `cancel-${suffix}`,
        region: "ir-thr-si1",
        size: "g1-1-1-0",
        image: "ubuntu-22.04",
        deliveryMode: DeliveryMode.MANAGED,
        ipv4: "203.0.113.77",
        providerState: "active",
        providerObservedAt: paidAt,
        status: CloudInstanceStatus.ACTIVE,
        provisionedAt: paidAt,
        deliveredAt: paidAt,
      },
    });
    instanceId = instance.id;

    await prisma.serviceSubscription.create({
      data: {
        cloudInstanceId: instance.id,
        sourceOrderId: order.id,
        userId: user.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        renewalPriceRial: 10_000_000n,
        currentPeriodStart: paidAt,
        currentPeriodEnd: periodEnd,
        nextRenewalAt: periodEnd,
        graceEndsAt: new Date(periodEnd.getTime() + 3 * 24 * 60 * 60 * 1000),
        termMonths: 1,
        autoRenew: true,
      },
    });

    // A) Cancel request with mutations OFF — must keep ACTIVE, disable autoRenew.
    process.env.ARVAN_MUTATIONS_ENABLED = "false";
    const requested = await requestCustomerServiceCancellation({
      instanceId: instance.id,
      userId: user.id,
      idempotencyKey: `cancel-lifecycle-request-${suffix}`,
      reason: "regression cancel request",
    });
    assert.equal(requested.lifecycle, "CANCEL_REQUESTED");
    assert.equal(requested.refund, null);

    let sub = await prisma.serviceSubscription.findUniqueOrThrow({
      where: { cloudInstanceId: instance.id },
    });
    assert.equal(sub.status, SubscriptionStatus.ACTIVE);
    assert.equal(sub.autoRenew, false);
    assert.ok(sub.canceledAt);
    assert.notEqual(sub.status, SubscriptionStatus.CANCELED);
    assert.notEqual(sub.status, SubscriptionStatus.TERMINATED);

    const refundCount = await prisma.walletLedgerEntry.count({
      where: { idempotencyKey: `order_cancel_refund_${order.id}` },
    });
    assert.equal(refundCount, 0);

    // B) Provider termination failure — must not terminate/refund.
    // Force a fresh cancel path by using a second instance-shaped request:
    // reopen via new idempotency after resetting request status is awkward;
    // instead seed a sibling instance and enable mutations with a bad key.
    const order2 = await prisma.serviceOrder.create({
      data: {
        userId: user.id,
        title: "Cancel fail order",
        description: "termination failure",
        amount: 10_000_000n,
        termMonths: 1,
        status: ServiceOrderStatus.PAID,
        planId: plan.id,
        planCode: plan.code,
        paidAt,
        productFlowState: "ACTIVE",
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
      },
    });
    const infra2 = await prisma.infrastructureOrder.create({
      data: {
        serviceOrderId: order2.id,
        userId: user.id,
        planId: plan.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        deliveryMode: DeliveryMode.MANAGED,
        status: InfrastructureOrderStatus.ACTIVE,
        requiredFundingRial: 10_000_000n,
        desiredInstanceName: `cancel-fail-${suffix}`,
        productFlowState: "ACTIVE",
      },
    });
    const instance2 = await prisma.cloudInstance.create({
      data: {
        infrastructureOrderId: infra2.id,
        userId: user.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        providerInstanceId: `arvan-cancel-fail-${suffix}`,
        name: `cancel-fail-${suffix}`,
        region: "ir-thr-si1",
        size: "g1-1-1-0",
        image: "ubuntu-22.04",
        deliveryMode: DeliveryMode.MANAGED,
        ipv4: "203.0.113.78",
        providerState: "active",
        providerObservedAt: paidAt,
        status: CloudInstanceStatus.ACTIVE,
        provisionedAt: paidAt,
        deliveredAt: paidAt,
      },
    });
    await prisma.serviceSubscription.create({
      data: {
        cloudInstanceId: instance2.id,
        sourceOrderId: order2.id,
        userId: user.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        renewalPriceRial: 10_000_000n,
        currentPeriodStart: paidAt,
        currentPeriodEnd: periodEnd,
        nextRenewalAt: periodEnd,
        graceEndsAt: new Date(periodEnd.getTime() + 3 * 24 * 60 * 60 * 1000),
        termMonths: 1,
        autoRenew: true,
      },
    });

    process.env.ARVAN_ENABLED = "true";
    process.env.ARVAN_API_KEY = "invalid-test-key-not-real";
    process.env.ARVAN_MUTATIONS_ENABLED = "true";

    const failed = await requestCustomerServiceCancellation({
      instanceId: instance2.id,
      userId: user.id,
      idempotencyKey: `cancel-lifecycle-fail-${suffix}`,
      reason: "regression termination failure",
    });
    assert.equal(failed.lifecycle, "TERMINATION_FAILED");
    assert.equal(failed.refund, null);
    assert.ok(failed.terminationError);

    sub = await prisma.serviceSubscription.findUniqueOrThrow({
      where: { cloudInstanceId: instance2.id },
    });
    assert.equal(sub.status, SubscriptionStatus.ACTIVE);
    assert.equal(sub.autoRenew, false);
    assert.notEqual(sub.status, SubscriptionStatus.CANCELED);
    assert.notEqual(sub.status, SubscriptionStatus.TERMINATED);

    const failRefunds = await prisma.walletLedgerEntry.count({
      where: { idempotencyKey: `order_cancel_refund_${order2.id}` },
    });
    assert.equal(failRefunds, 0);

    const inst2 = await prisma.cloudInstance.findUniqueOrThrow({
      where: { id: instance2.id },
    });
    assert.equal(inst2.status, CloudInstanceStatus.ACTIVE);
  } finally {
    process.env.ARVAN_ENABLED = previous.arvanEnabled;
    process.env.ARVAN_API_KEY = previous.arvanKey;
    process.env.ARVAN_MUTATIONS_ENABLED = previous.arvanMutations;

    if (userId) {
      await prisma.walletLedgerEntry.deleteMany({
        where: { wallet: { userId } },
      });
      await prisma.resourceChangeRequest.deleteMany({
        where: { cloudInstance: { userId } },
      });
      await prisma.serviceSubscription.deleteMany({ where: { userId } });
      await prisma.cloudInstance.deleteMany({ where: { userId } });
      await prisma.infrastructureOrder.deleteMany({ where: { userId } });
      await prisma.serviceOrder.deleteMany({ where: { userId } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    if (planId) {
      await prisma.infrastructurePlan.delete({ where: { id: planId } }).catch(
        () => undefined,
      );
    }
    if (catalogItemId) {
      await prisma.providerCatalogItem
        .delete({ where: { id: catalogItemId } })
        .catch(() => undefined);
    }
    void instanceId;
    void orderId;
    await prisma.$disconnect();
  }
});
