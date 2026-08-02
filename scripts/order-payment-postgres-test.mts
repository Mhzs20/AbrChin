import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  InfrastructureOrderStatus,
  PrismaClient,
  ServiceOrderStatus,
  UserRole,
  WalletStatus,
} from "@prisma/client";

import {
  createOrderPaymentIntent,
  finalizeOrderPaymentFromCallback,
} from "../lib/payments/order-payment.ts";
import {
  approveProvision,
  getProvisionApprovalReview,
} from "../lib/infrastructure/provision-approval.ts";
import {
  approveDelivery,
  getDeliveryApprovalReview,
} from "../lib/infrastructure/delivery-approval.ts";
import { completeManualReadyDelivery } from "../lib/infrastructure/manual-ready-delivery.ts";
import { dispatchApprovedProvision } from "../lib/infrastructure/provision-dispatch.ts";
import {
  claimNextProvisioningJob,
  processProvisioningJob,
} from "../lib/infrastructure/provisioning-service.ts";
import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import {
  credentialFingerprint,
  encryptCredential,
} from "../lib/security/credential-vault.ts";
import {
  revealInstanceCredential,
  revealInstanceCredentialForAdmin,
} from "../lib/security/instance-credentials.ts";
import { getActivePlanByCode, toPlanSnapshot } from "../lib/orders/plans.ts";

const databaseUrl = process.env.DATABASE_URL;
const runIsolated = process.env.ABRCHIN_ISOLATED_TEST === "1";
const prisma = databaseUrl && runIsolated ? new PrismaClient() : null;

test("one verified gateway callback records one payment, ledger, and waiting order", async (t) => {
  if (!prisma) {
    t.skip("requires ABRCHIN_ISOLATED_TEST=1 and DATABASE_URL");
    return;
  }

  const suffix = Date.now().toString(36);
  const planCode = `PAYMENT_CALLBACK_${suffix}`;
  const userMobile = `099${suffix.slice(-8).padStart(8, "0")}`;
  const now = new Date();
  const priceCheckedAt = new Date(now.getTime() - 1_000);
  const validUntil = new Date(now.getTime() + 10 * 60 * 1_000);
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    defaultGateway: process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER,
    callbackBase: process.env.PAYMENT_CALLBACK_BASE_URL,
    publicSale: process.env.PARSPACK_PUBLIC_SALE_ENABLED,
    mutations: process.env.PARSPACK_MUTATIONS_ENABLED,
    credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
  };

  process.env.NODE_ENV = "development";
  process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER = "mock";
  process.env.PAYMENT_CALLBACK_BASE_URL = "http://localhost:3010";
  process.env.PARSPACK_PUBLIC_SALE_ENABLED = "true";
  process.env.PARSPACK_MUTATIONS_ENABLED = "true";
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  }

  await prisma.paymentGatewayConfig.updateMany({ data: { isDefault: false } });
  await prisma.paymentGatewayConfig.update({
    where: { provider: "MOCK" },
    data: { enabled: true, isDefault: true, environment: "DEVELOPMENT" },
  });

  let userId = "";
  let planId = "";
  let catalogItemId = "";
  let orderId = "";
  let adminUserId = "";
  let manualPlanId = "";
  let inventoryCatalogItemId = "";
  let inventoryPlanId = "";
  let inventoryItemId = "";
  let inventoryInfrastructureOrderId = "";
  let inventoryQuoteId = "";
  let inventorySessionId = "";
  try {
    const catalog = await prisma.providerCatalogItem.create({
      data: {
        provider: "PARSPACK",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        regionCode: `payment-${suffix}`,
        sizeCode: "callback-vps",
        externalPlanId: "callback-vps",
        externalKey: `parspack:v1:payment-${suffix}:callback-vps`,
        sizeName: "Callback test VPS",
        compatibleImageCodes: ["ubuntu-callback"],
        vcpu: 2,
        ramMb: 2048,
        diskGb: 40,
        available: true,
        active: true,
        status: "ACTIVE",
        priceMonthlyAmount: 1_000_000n,
        priceScale: 0,
        currencyCode: "IRR",
        amountUnit: "RIAL",
        providerMonthlyPriceIrr: 1_000_000n,
        lastSyncedAt: priceCheckedAt,
        lastSeenAt: priceCheckedAt,
        rawPayload: {},
        payloadHash: `payment-callback-${suffix}`,
        catalogVersion: `payment-callback-${suffix}`,
      },
    });
    catalogItemId = catalog.id;
    await prisma.providerCatalogState.upsert({
      where: { provider: "PARSPACK" },
      update: {
        enabled: true,
        lastCatalogSync: now,
        lastSyncStatus: "SUCCEEDED",
        freshnessSlaSeconds: 900,
      },
      create: {
        id: "parspack",
        provider: "PARSPACK",
        enabled: true,
        lastCatalogSync: now,
        lastSyncStatus: "SUCCEEDED",
        freshnessSlaSeconds: 900,
      },
    });
    await prisma.providerPricingConfig.upsert({
      where: { provider: "PARSPACK" },
      update: {
        apiVersion: "v1",
        enabled: true,
        markupBasisPoints: 0,
        sourceMoneyUnit: "RIAL",
      },
      create: {
        id: "parspack",
        provider: "PARSPACK",
        apiVersion: "v1",
        enabled: true,
        markupBasisPoints: 0,
        sourceMoneyUnit: "RIAL",
      },
    });
    await prisma.productPricingConfig.upsert({
      where: {
        provider_apiVersion_productKind: {
          provider: "PARSPACK",
          apiVersion: "v1",
          productKind: "READY_INSTANT_SERVER",
        },
      },
      update: { enabled: true, markupBasisPoints: 0 },
      create: {
        id: "payment-callback-parspack-ready",
        provider: "PARSPACK",
        apiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        enabled: true,
        markupBasisPoints: 0,
      },
    });
    const plan = await prisma.infrastructurePlan.create({
      data: {
        code: planCode,
        title: "Payment callback test",
        provider: "PARSPACK",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        regionCode: catalog.regionCode,
        sizeCode: catalog.sizeCode,
        imageCode: "ubuntu-callback",
        deliveryMode: "MANAGED",
        salePriceRial: 1_000_000n,
        renewalPriceRial: 1_000_000n,
        estimatedProviderCostRial: 1_000_000n,
        vcpu: 2,
        ramGb: 2,
        storageGb: 40,
        catalogItemId: catalog.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: priceCheckedAt,
        parchinIncluded: true,
        minimumParchinLevel: "PARCHIN_START",
        active: true,
        publicationStatus: "PUBLISHED",
      },
    });
    planId = plan.id;
    const pricedPlan = await getActivePlanByCode(plan.code);
    assert.ok(pricedPlan);

    const user = await prisma.user.create({ data: { mobile: userMobile } });
    userId = user.id;
    await prisma.wallet.create({
      data: { userId, availableBalance: 0n, status: WalletStatus.ACTIVE },
    });
    const order = await prisma.serviceOrder.create({
      data: {
        userId,
        title: plan.title,
        amount: pricedPlan.pricing.finalPriceRial,
        status: ServiceOrderStatus.PENDING_PAYMENT,
        planId: plan.id,
        planCode: plan.code,
        planSnapshot: toPlanSnapshot(pricedPlan, { createdAt: now, expiresAt: validUntil }),
        quoteExpiresAt: validUntil,
        provider: "PARSPACK",
        providerApiVersion: "v1",
        productKind: "READY_INSTANT_SERVER",
        parchinLevel: pricedPlan.pricing.parchinLevel,
        productFlowState: "AWAITING_PAYMENT",
      },
    });
    orderId = order.id;

    const idempotencyKey = `order-payment-callback-${suffix}`.padEnd(24, "x");
    const intent = await createOrderPaymentIntent({ userId, orderId, idempotencyKey });
    assert.equal(intent.alreadyPaid, false);
    assert.ok(intent.redirectUrl);
    const replayedIntent = await createOrderPaymentIntent({ userId, orderId, idempotencyKey });
    assert.equal(replayedIntent.payment?.id, intent.payment?.id);

    const mockGatewayUrl = new URL(intent.redirectUrl!);
    const callbackUrl = new URL(mockGatewayUrl.searchParams.get("callback")!);
    const token = callbackUrl.searchParams.get("token");
    const paymentId = callbackUrl.searchParams.get("paymentId");
    assert.ok(token);
    assert.equal(paymentId, intent.payment?.id);
    const persistedIntent = await prisma.orderPayment.findUniqueOrThrow({
      where: { id: paymentId! },
    });

    const first = await finalizeOrderPaymentFromCallback({
      expectedGateway: "MOCK",
      paymentId: paymentId!,
      token: token!,
      authority: persistedIntent.authority,
      statusHint: "OK",
    });
    const replay = await finalizeOrderPaymentFromCallback({
      expectedGateway: "MOCK",
      paymentId: paymentId!,
      token: token!,
      authority: persistedIntent.authority,
      statusHint: "OK",
    });
    assert.equal(first.payment.status, "SUCCEEDED");
    assert.equal(replay.payment.status, "SUCCEEDED");
    assert.equal(replay.alreadySettled, true);
    assert.equal(first.order.status, ServiceOrderStatus.PAID);
    assert.equal(
      await prisma.infrastructureOrder.count({
        where: { serviceOrderId: orderId, status: InfrastructureOrderStatus.WAITING_ADMIN_FUNDING },
      }),
      1,
    );
    assert.equal(await prisma.provisioningJob.count({ where: { infrastructureOrder: { serviceOrderId: orderId } } }), 0);
    assert.equal(await prisma.cloudInstance.count({ where: { infrastructureOrder: { serviceOrderId: orderId } } }), 0);
    assert.equal(
      await prisma.walletLedgerEntry.count({
        where: { referenceType: "order_payment", referenceId: paymentId! },
      }),
      1,
    );
    assert.equal(
      await prisma.walletLedgerEntry.count({
        where: { referenceType: "order", referenceId: orderId },
      }),
      1,
    );
    assert.equal(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).availableBalance,
      0n,
    );

    const infrastructureOrder = await prisma.infrastructureOrder.findUniqueOrThrow({
      where: { serviceOrderId: orderId },
    });
    const review = await getProvisionApprovalReview(infrastructureOrder.id);
    assert.equal(review.canApprove, true);
    assert.equal(review.balance.requiresConfirmation, true);

    const admin = await prisma.user.create({
      data: {
        mobile: `098${suffix.slice(-8).padStart(8, "0")}`,
        role: UserRole.ADMIN,
      },
    });
    adminUserId = admin.id;
    await assert.rejects(
      approveProvision({
        infrastructureOrderId: infrastructureOrder.id,
        adminUserId,
        reason: "بررسی کامل Provider",
        providerBalanceConfirmed: false,
        idempotencyKey: `provision-approve:${infrastructureOrder.id}`,
      }),
      /موجودی یا شارژ Provider/,
    );
    const approved = await approveProvision({
      infrastructureOrderId: infrastructureOrder.id,
      adminUserId,
      reason: "بررسی کامل Provider",
      providerBalanceConfirmed: true,
      idempotencyKey: `provision-approve:${infrastructureOrder.id}`,
    });
    const approvalReplay = await approveProvision({
      infrastructureOrderId: infrastructureOrder.id,
      adminUserId,
      reason: "بررسی کامل Provider",
      providerBalanceConfirmed: true,
      idempotencyKey: `provision-approve:${infrastructureOrder.id}`,
    });
    assert.equal(approved.approved, true);
    assert.deepEqual(approvalReplay, approved);
    assert.deepEqual(
      await prisma.infrastructureOrder.findUniqueOrThrow({
        where: { id: infrastructureOrder.id },
        select: { status: true, productFlowState: true },
      }),
      {
        status: InfrastructureOrderStatus.FUNDING_CONFIRMED,
        productFlowState: "PROVISION_APPROVED",
      },
    );
    assert.equal(
      await prisma.provisioningJob.count({
        where: { infrastructureOrderId: infrastructureOrder.id },
      }),
      0,
    );
    assert.equal(
      await prisma.cloudInstance.count({
        where: { infrastructureOrderId: infrastructureOrder.id },
      }),
      0,
    );
    assert.equal(
      await prisma.adminCommandReceipt.count({
        where: { infrastructureOrderId: infrastructureOrder.id, operation: "APPROVE_PROVISION" },
      }),
      1,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          entityType: "infrastructure_order",
          entityId: infrastructureOrder.id,
          action: "provision_approved",
        },
      }),
      1,
    );

    const manualPlan = await prisma.infrastructurePlan.create({
      data: {
        code: `MANUAL_FULFILLMENT_${suffix}`,
        title: "Manual fulfillment test",
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        regionCode: `manual-${suffix}`,
        sizeCode: "manual-plan",
        imageCode: "manual-image",
        deliveryMode: "MANAGED",
        salePriceRial: 1_000_000n,
        renewalPriceRial: 1_000_000n,
        estimatedProviderCostRial: 1_000_000n,
        offerSource: "MANUAL_ADMIN",
        offerLastVerifiedAt: now,
        offerPriceValidUntil: validUntil,
        active: true,
        publicationStatus: "PUBLISHED",
      },
    });
    manualPlanId = manualPlan.id;
    const manualOrder = await prisma.serviceOrder.create({
      data: {
        userId,
        title: manualPlan.title,
        amount: manualPlan.salePriceRial,
        status: ServiceOrderStatus.PAID,
        planId: manualPlan.id,
        planCode: manualPlan.code,
        planSnapshot: {},
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        productFlowState: "PROVISION_APPROVED",
        paidAt: now,
      },
    });
    const manualInfrastructureOrder = await prisma.infrastructureOrder.create({
      data: {
        serviceOrderId: manualOrder.id,
        userId,
        planId: manualPlan.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        providerSelectionSnapshot: {
          provider: "ARVAN",
          providerApiVersion: "v1",
          productKind: "CLOUD_SERVER",
          offerSource: "MANUAL_ADMIN",
          region: manualPlan.regionCode,
          externalPlanId: manualPlan.sizeCode,
          externalImageId: manualPlan.imageCode,
          externalNetworkId: "manual-network",
          externalSecurityId: "manual-security",
          topologyVerificationMode: "STRICT_OBSERVED",
          deliveryConfiguration: {
            provider: "ARVAN",
            providerApiVersion: "v1",
            productKind: "CLOUD_SERVER",
            region: manualPlan.regionCode,
            externalPlanId: manualPlan.sizeCode,
            externalImageId: manualPlan.imageCode,
            externalNetworkId: "manual-network",
            externalSecurityId: "manual-security",
            topologyVerificationMode: "STRICT_OBSERVED",
            accessMethod: "ONE_TIME_PASSWORD",
          },
        },
        deliveryMode: "MANAGED",
        status: InfrastructureOrderStatus.FUNDING_CONFIRMED,
        requiredFundingRial: 0n,
        productFlowState: "PROVISION_APPROVED",
      },
    });
    await prisma.adminCommandReceipt.create({
      data: {
        operation: "APPROVE_PROVISION",
        idempotencyKey: `admin-command:provision-approve:${manualInfrastructureOrder.id}`,
        requestFingerprint: `fixture-approval-${suffix}`,
        actorUserId: adminUserId,
        infrastructureOrderId: manualInfrastructureOrder.id,
        resultSnapshot: { approved: true, containsSecret: false },
      },
    });
    const manualSecret = `fixture-${suffix}-credential`;
    const manualInput = {
      infrastructureOrderId: manualInfrastructureOrder.id,
      adminUserId,
      providerResourceId: `manual-resource-${suffix}`,
      ipv4: "198.51.100.8",
      region: manualPlan.regionCode,
      externalPlanId: manualPlan.sizeCode,
      externalImageId: manualPlan.imageCode,
      username: "root",
      secret: manualSecret,
      reason: "ثبت کنترل‌شده Fulfillment دستی",
      idempotencyKey: `manual-provision:${manualInfrastructureOrder.id}`,
    };
    const manualFirst = await completeManualReadyDelivery(manualInput);
    const manualReplay = await completeManualReadyDelivery(manualInput);
    assert.deepEqual(manualReplay, manualFirst);
    const manualInstance = await prisma.cloudInstance.findUniqueOrThrow({
      where: { id: manualFirst.cloudInstanceId },
      include: { credential: true },
    });
    assert.equal(manualInstance.status, "PENDING");
    assert.ok(manualInstance.credential?.ciphertext);
    assert.notEqual(manualInstance.credential?.ciphertext, manualSecret);
    assert.equal(
      await prisma.serviceSubscription.count({ where: { cloudInstanceId: manualInstance.id } }),
      0,
    );
    assert.deepEqual(
      await prisma.infrastructureOrder.findUniqueOrThrow({
        where: { id: manualInfrastructureOrder.id },
        select: { status: true, productFlowState: true },
      }),
      {
        status: InfrastructureOrderStatus.PROVISIONING,
        productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL",
      },
    );
    assert.equal(
      await prisma.secureDeliveryEvent.count({
        where: {
          infrastructureOrderId: manualInfrastructureOrder.id,
          status: "PENDING",
        },
      }),
      1,
    );
    const manualAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        actorUserId: adminUserId,
        action: "manual_provision",
        entityId: manualInfrastructureOrder.id,
      },
    });
    assert.equal(JSON.stringify(manualAudit.afterData).includes(manualSecret), false);

    const inventoryCatalog = await prisma.providerCatalogItem.create({
      data: {
        provider: "ARVAN",
        apiVersion: "v1",
        productKind: "CLOUD_SERVER",
        regionCode: `inventory-${suffix}`,
        sizeCode: "inventory-plan",
        externalPlanId: "inventory-plan",
        externalKey: `arvan:v1:inventory-${suffix}:inventory-plan`,
        sizeName: "Inventory test server",
        compatibleImageCodes: ["inventory-image"],
        vcpu: 2,
        ramMb: 2048,
        diskGb: 40,
        available: true,
        active: true,
        status: "ACTIVE",
        priceMonthlyAmount: 1_000_000n,
        priceScale: 0,
        currencyCode: "IRR",
        amountUnit: "RIAL",
        providerMonthlyPriceIrr: 1_000_000n,
        lastSyncedAt: now,
        lastSeenAt: now,
        rawPayload: {},
        payloadHash: `inventory-${suffix}`,
        catalogVersion: `inventory-${suffix}`,
      },
    });
    inventoryCatalogItemId = inventoryCatalog.id;
    const inventoryPlan = await prisma.infrastructurePlan.create({
      data: {
        code: `PREPROVISIONED_${suffix}`,
        title: "Preprovisioned inventory test",
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        regionCode: inventoryCatalog.regionCode,
        sizeCode: inventoryCatalog.sizeCode,
        imageCode: "inventory-image",
        deliveryMode: "MANAGED",
        salePriceRial: 1_000_000n,
        renewalPriceRial: 1_000_000n,
        estimatedProviderCostRial: 1_000_000n,
        offerSource: "PREPROVISIONED_INVENTORY",
        offerLastVerifiedAt: now,
        offerPriceValidUntil: validUntil,
        catalogItemId: inventoryCatalog.id,
        catalogMappingStatus: "MAPPED",
        catalogMappedAt: now,
        active: true,
        publicationStatus: "PUBLISHED",
      },
    });
    inventoryPlanId = inventoryPlan.id;
    const inventorySession = await prisma.recommendationSession.create({
      data: {
        userId,
        status: "CONVERTED",
        answers: {},
        answerSources: {},
        productFlowState: "PROVISION_APPROVED",
        expiresAt: validUntil,
      },
    });
    inventorySessionId = inventorySession.id;
    const inventoryQuote = await prisma.recommendationQuote.create({
      data: {
        sessionId: inventorySession.id,
        planId: inventoryPlan.id,
        role: "RECOMMENDED",
        status: "CONVERTED",
        score: 1,
        scoreBreakdown: {},
        reasons: [],
        profileSnapshot: {},
        planSnapshot: {},
        amountRial: inventoryPlan.salePriceRial,
        renewalAmountRial: inventoryPlan.renewalPriceRial!,
        expiresAt: validUntil,
      },
    });
    inventoryQuoteId = inventoryQuote.id;
    const inventoryOrder = await prisma.serviceOrder.create({
      data: {
        userId,
        title: inventoryPlan.title,
        amount: inventoryPlan.salePriceRial,
        status: ServiceOrderStatus.PAID,
        planId: inventoryPlan.id,
        planCode: inventoryPlan.code,
        planSnapshot: {},
        recommendationQuoteId: inventoryQuote.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        productFlowState: "PROVISION_APPROVED",
        paidAt: now,
      },
    });
    const inventoryItem = await prisma.preprovisionedInventoryItem.create({
      data: {
        catalogItemId: inventoryCatalog.id,
        planId: inventoryPlan.id,
        provider: "ARVAN",
        apiVersion: "v1",
        providerResourceId: `inventory-resource-${suffix}`,
        regionCode: inventoryPlan.regionCode,
        externalPlanId: inventoryPlan.sizeCode,
        externalImageId: inventoryPlan.imageCode,
        observedState: "active",
        observedIpv4: "198.51.100.9",
        observedNetworkId: "inventory-network",
        observedSecurityId: "inventory-security",
        lastObservedAt: now,
        lastHealthCheckedAt: now,
        healthStatus: "HEALTHY",
        inventoryStatus: "RESERVED",
        reservedByQuoteId: inventoryQuote.id,
        reservedByOrderId: inventoryOrder.id,
        reservedRevision: 0,
        reservedAt: now,
        reservationExpiresAt: validUntil,
        createdById: adminUserId,
        updatedById: adminUserId,
      },
    });
    inventoryItemId = inventoryItem.id;
    const inventorySecret = `fixture-${suffix}-inventory-credential`;
    await prisma.preprovisionedInventoryCredential.create({
      data: {
        inventoryItemId: inventoryItem.id,
        username: "root",
        ...encryptCredential(inventorySecret),
        secretFingerprint: credentialFingerprint(inventorySecret),
        status: "READY",
        createdById: adminUserId,
      },
    });
    const inventoryInfrastructureOrder = await prisma.infrastructureOrder.create({
      data: {
        serviceOrderId: inventoryOrder.id,
        userId,
        planId: inventoryPlan.id,
        provider: "ARVAN",
        providerApiVersion: "v1",
        productKind: "CLOUD_SERVER",
        providerSelectionSnapshot: {
          provider: "ARVAN",
          providerApiVersion: "v1",
          productKind: "CLOUD_SERVER",
          offerSource: "PREPROVISIONED_INVENTORY",
          catalogItemId: inventoryCatalog.id,
          region: inventoryPlan.regionCode,
          externalPlanId: inventoryPlan.sizeCode,
          externalImageId: inventoryPlan.imageCode,
          externalNetworkId: "inventory-network",
          externalSecurityId: "inventory-security",
          topologyVerificationMode: "STRICT_OBSERVED",
          deliveryConfiguration: {
            provider: "ARVAN",
            providerApiVersion: "v1",
            productKind: "CLOUD_SERVER",
            region: inventoryPlan.regionCode,
            externalPlanId: inventoryPlan.sizeCode,
            externalImageId: inventoryPlan.imageCode,
            externalNetworkId: "inventory-network",
            externalSecurityId: "inventory-security",
            topologyVerificationMode: "STRICT_OBSERVED",
            accessMethod: "ONE_TIME_PASSWORD",
          },
        },
        deliveryMode: "MANAGED",
        status: InfrastructureOrderStatus.FUNDING_CONFIRMED,
        requiredFundingRial: 0n,
        productFlowState: "PROVISION_APPROVED",
        preprovisionedInventoryItemId: inventoryItem.id,
      },
    });
    inventoryInfrastructureOrderId = inventoryInfrastructureOrder.id;
    await prisma.adminCommandReceipt.create({
      data: {
        operation: "APPROVE_PROVISION",
        idempotencyKey: `admin-command:provision-approve:${inventoryInfrastructureOrder.id}`,
        requestFingerprint: `fixture-inventory-approval-${suffix}`,
        actorUserId: adminUserId,
        infrastructureOrderId: inventoryInfrastructureOrder.id,
        resultSnapshot: { approved: true, containsSecret: false },
      },
    });
    const [inventoryDispatchA, inventoryDispatchB] = await Promise.all([
      dispatchApprovedProvision(inventoryInfrastructureOrder.id),
      dispatchApprovedProvision(inventoryInfrastructureOrder.id),
    ]);
    assert.equal(
      [inventoryDispatchA, inventoryDispatchB].filter((result) => result.state === "DISPATCHED").length,
      1,
    );
    assert.equal(
      [inventoryDispatchA, inventoryDispatchB].filter((result) => result.state === "ALREADY_DISPATCHED").length,
      1,
    );
    const assignedInventory = await prisma.preprovisionedInventoryItem.findUniqueOrThrow({
      where: { id: inventoryItem.id },
      include: { credential: true },
    });
    assert.equal(assignedInventory.inventoryStatus, "ASSIGNED");
    assert.equal(assignedInventory.assignedOrderId, inventoryOrder.id);
    assert.equal(assignedInventory.credential?.status, "TRANSFERRED");
    const claimedInventoryJob = await claimNextProvisioningJob("p17-inventory-worker");
    assert.ok(claimedInventoryJob?.claimToken);
    const inventoryProvider = new FakeCloudProviderAdapter({ provider: "ARVAN" });
    await processProvisioningJob(claimedInventoryJob!.id, inventoryProvider, {
      claimToken: claimedInventoryJob!.claimToken!,
      healthProbe: async () => true,
    });
    const inventoryFinal = await prisma.infrastructureOrder.findUniqueOrThrow({
      where: { id: inventoryInfrastructureOrder.id },
      include: {
        cloudInstance: { include: { credential: true } },
        provisioningJobs: true,
      },
    });
    assert.equal(inventoryFinal.productFlowState, "WAITING_ADMIN_DELIVERY_APPROVAL");
    assert.equal(inventoryFinal.cloudInstance?.status, "PENDING");
    assert.equal(inventoryFinal.cloudInstance?.credential?.ciphertext === inventorySecret, false);
    assert.equal(inventoryFinal.provisioningJobs.length, 1);
    assert.equal(inventoryProvider.createCalls.length, 0);
    assert.equal(
      await prisma.serviceSubscription.count({
        where: { sourceOrderId: inventoryOrder.id },
      }),
      0,
    );
    assert.ok(inventoryFinal.cloudInstance);
    const inventoryInstanceId = inventoryFinal.cloudInstance.id;
    const pendingReview = await getDeliveryApprovalReview(inventoryInfrastructureOrder.id);
    assert.equal(pendingReview.canApprove, true);
    assert.equal(pendingReview.credential.status, "READY");
    const adminCredential = await revealInstanceCredentialForAdmin({
      instanceId: inventoryInstanceId,
    });
    assert.equal(adminCredential.secret, inventorySecret);
    assert.equal(
      (await prisma.instanceCredential.findUniqueOrThrow({
        where: { cloudInstanceId: inventoryInstanceId },
      })).status,
      "READY",
    );
    await assert.rejects(
      revealInstanceCredential({ instanceId: inventoryInstanceId, userId }),
      /آماده نیست/,
    );
    const deliveryApproved = await approveDelivery({
      infrastructureOrderId: inventoryInfrastructureOrder.id,
      adminUserId,
      reason: "Resource، Health و Credential بررسی شد.",
      idempotencyKey: `delivery-approve:${inventoryInfrastructureOrder.id}`,
    });
    const deliveryReplay = await approveDelivery({
      infrastructureOrderId: inventoryInfrastructureOrder.id,
      adminUserId,
      reason: "Resource، Health و Credential بررسی شد.",
      idempotencyKey: `delivery-approve:${inventoryInfrastructureOrder.id}`,
    });
    assert.equal(deliveryApproved.approved, true);
    assert.deepEqual(deliveryReplay, deliveryApproved);
    const deliveredInventory = await prisma.infrastructureOrder.findUniqueOrThrow({
      where: { id: inventoryInfrastructureOrder.id },
      include: { cloudInstance: { include: { credential: true, subscription: true } } },
    });
    assert.equal(deliveredInventory.status, InfrastructureOrderStatus.ACTIVE);
    assert.equal(deliveredInventory.productFlowState, "ACTIVE");
    assert.equal(deliveredInventory.cloudInstance?.status, "ACTIVE");
    assert.ok(deliveredInventory.cloudInstance?.subscription);
    assert.equal(
      await prisma.adminCommandReceipt.count({
        where: {
          infrastructureOrderId: inventoryInfrastructureOrder.id,
          operation: "APPROVE_DELIVERY",
        },
      }),
      1,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          entityType: "infrastructure_order",
          entityId: inventoryInfrastructureOrder.id,
          action: "delivery_approved",
        },
      }),
      1,
    );
    await assert.rejects(
      revealInstanceCredential({ instanceId: inventoryInstanceId, userId: adminUserId }),
      /آماده نیست/,
    );
    const customerCredential = await revealInstanceCredential({
      instanceId: inventoryInstanceId,
      userId,
    });
    assert.equal(customerCredential.secret, inventorySecret);
    await assert.rejects(
      revealInstanceCredential({ instanceId: inventoryInstanceId, userId }),
      /قبلاً نمایش داده شده/,
    );
    const notification = await prisma.provisioningNotificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: `instance-active:${inventoryInfrastructureOrder.id}` },
    });
    assert.equal(JSON.stringify(notification).includes(inventorySecret), false);
  } finally {
    if (inventoryInfrastructureOrderId) {
      await prisma.infrastructureOrder.deleteMany({
        where: { id: inventoryInfrastructureOrderId },
      });
    }
    if (inventoryItemId) {
      await prisma.preprovisionedInventoryCredential.deleteMany({
        where: { inventoryItemId },
      });
      await prisma.preprovisionedInventoryItem.deleteMany({ where: { id: inventoryItemId } });
    }
    if (inventoryQuoteId) {
      await prisma.recommendationQuote.deleteMany({ where: { id: inventoryQuoteId } });
    }
    if (inventorySessionId) {
      await prisma.recommendationSession.deleteMany({ where: { id: inventorySessionId } });
    }
    if (orderId) await prisma.serviceOrder.deleteMany({ where: { id: orderId } });
    if (adminUserId) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: adminUserId } });
      await prisma.adminCommandReceipt.deleteMany({ where: { actorUserId: adminUserId } });
      await prisma.instanceCredential.deleteMany({ where: { createdById: adminUserId } });
      await prisma.user.deleteMany({ where: { id: adminUserId } });
    }
    if (userId) {
      await prisma.walletLedgerEntry.deleteMany({ where: { wallet: { userId } } });
      await prisma.wallet.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (planId) await prisma.infrastructurePlan.deleteMany({ where: { id: planId } });
    if (manualPlanId) await prisma.infrastructurePlan.deleteMany({ where: { id: manualPlanId } });
    if (inventoryPlanId) await prisma.infrastructurePlan.deleteMany({ where: { id: inventoryPlanId } });
    if (catalogItemId) await prisma.providerCatalogItem.deleteMany({ where: { id: catalogItemId } });
    if (inventoryCatalogItemId) await prisma.providerCatalogItem.deleteMany({ where: { id: inventoryCatalogItemId } });
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER = previous.defaultGateway;
    process.env.PAYMENT_CALLBACK_BASE_URL = previous.callbackBase;
    process.env.PARSPACK_PUBLIC_SALE_ENABLED = previous.publicSale;
    process.env.PARSPACK_MUTATIONS_ENABLED = previous.mutations;
    if (previous.credentialEncryptionKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = previous.credentialEncryptionKey;
    }
    await prisma.$disconnect();
  }
});
