import { randomUUID } from "node:crypto";

import {
  ActivationRequestStatus,
  InfrastructureOfferSource,
  InfrastructureOrderStatus,
  InfrastructureProductKind,
  InfrastructureProvider,
  Prisma,
  RecommendationFlowStatus,
  RecommendationQuoteStatus,
  ServiceOrderStatus,
  type BillingCadence,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import {
  buildActivationBillingSnapshot,
  getEffectiveBillingPolicy,
} from "@/lib/billing/policy-service";
import { calculateMarkupRial } from "@/lib/billing/policy";
import {
  getEffectiveProviderBillingContract,
  requireVerifiedProviderBillingContract,
  serializeProviderBillingContract,
} from "@/lib/billing/provider-contract";
import { prisma } from "@/lib/db";
import { idempotencyFingerprint } from "@/lib/idempotency";
import { assertPublicSaleEnabled } from "@/lib/infrastructure/public-sale-policy";
import { transitionProductFlowTx } from "@/lib/product-flow/service";
import { WalletError } from "@/lib/wallet/errors";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

type QuoteForEstimate = {
  id: string;
  providerHourlyPriceIrr: bigint | null;
  markupBasisPointsSnapshot: number | null;
  providerApiVersion: string | null;
  expiresAt: Date;
  plan: {
    id: string;
    billingModel: "PAYG_WALLET" | "PREPAID_TERM";
    provider: "ARVAN" | "PARSPACK";
  };
};

async function estimateForQuote(
  quote: QuoteForEstimate,
  cadence: BillingCadence,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (quote.plan.billingModel !== "PAYG_WALLET") {
    throw new WalletError(
      "prepaid_checkout_required",
      "این محصول قرارداد مدت‌دار دارد و از Checkout جداگانه استفاده می‌کند.",
    );
  }
  const providerHourlyRial = quote.providerHourlyPriceIrr;
  const markupBasisPoints = quote.markupBasisPointsSnapshot;
  if (
    providerHourlyRial == null ||
    providerHourlyRial <= 0n ||
    markupBasisPoints == null
  ) {
    throw new WalletError(
      "hourly_estimate_unavailable",
      "نرخ ساعتی معتبر برای این چینش در دسترس نیست.",
    );
  }
  const markupHourlyRial = calculateMarkupRial(
    providerHourlyRial,
    markupBasisPoints,
  );
  const hourlyEstimateRial = providerHourlyRial + markupHourlyRial;
  const dailyEstimateRial = hourlyEstimateRial * 24n;
  const oneTimeChargesRial = 0n;
  const policy = await getEffectiveBillingPolicy(
    quote.plan.id,
    new Date(),
    db,
  );
  const providerContract = await getEffectiveProviderBillingContract(
    {
      provider: quote.plan.provider,
      // Missing Provider API identity must resolve to no contract, never a
      // guessed contract version.
      providerApiVersion: quote.providerApiVersion ?? "__missing__",
      productKind: "CLOUD_SERVER",
    },
    db,
  );
  const billingSnapshot = buildActivationBillingSnapshot({
    policy,
    cadence,
    hourlyEstimateRial,
    dailyEstimateRial,
    oneTimeChargesRial,
    providerContract,
  });
  return {
    policy,
    providerContract,
    providerHourlyRial,
    markupBasisPoints,
    markupHourlyRial,
    hourlyEstimateRial,
    dailyEstimateRial,
    oneTimeChargesRial,
    billingSnapshot,
  };
}

export async function getActivationEstimate(input: {
  quoteId: string;
  userId: string;
  cadence: BillingCadence;
}) {
  const quote = await prisma.recommendationQuote.findFirst({
    where: {
      id: input.quoteId,
      session: { userId: input.userId },
      status: {
        in: [
          RecommendationQuoteStatus.ACTIVE,
          RecommendationQuoteStatus.SELECTED,
        ],
      },
    },
    include: { plan: true },
  });
  if (!quote) {
    throw new WalletError("quote_not_found", "Estimate معتبر پیدا نشد.");
  }
  const estimate = await estimateForQuote(quote, input.cadence);
  return {
    quoteId: quote.id,
    expiresAt: quote.expiresAt,
    cadence: input.cadence,
    hourlyEstimateRial: estimate.hourlyEstimateRial,
    dailyEstimateRial: estimate.dailyEstimateRial,
    oneTimeChargesRial: estimate.oneTimeChargesRial,
    minimumCreditRequiredRial:
      estimate.billingSnapshot.minimumCreditRial,
    displayMode: estimate.billingSnapshot.displayMode,
    availability: estimate.policy.availability,
    estimated: true as const,
  };
}

export async function requestActivation(input: {
  quoteId: string;
  userId: string;
  cadence: BillingCadence;
  idempotencyKey: string;
}) {
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    throw new WalletError(
      "invalid_idempotency_key",
      "شناسه یکتای درخواست فعال‌سازی معتبر نیست.",
    );
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`activation:${input.idempotencyKey}`}, 0)
        )::text AS locked
      `;
      const existing = await tx.activationRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { serviceOrder: true },
      });
      const fingerprint = idempotencyFingerprint({
        quoteId: input.quoteId,
        userId: input.userId,
        cadence: input.cadence,
      });
      if (existing) {
        const snapshot = existing.estimateSnapshot as Record<string, unknown>;
        if (snapshot.requestFingerprint !== fingerprint) {
          throw new WalletError(
            "idempotency_conflict",
            "این شناسه برای درخواست دیگری استفاده شده است.",
          );
        }
        if (existing.status === ActivationRequestStatus.CREDIT_REQUIRED) {
          const wallet = await tx.wallet.findUniqueOrThrow({
            where: { userId: input.userId },
          });
          if (
            wallet.availableBalance >= existing.minimumCreditRequiredRial
          ) {
            return tx.activationRequest.update({
              where: { id: existing.id },
              data: {
                status: ActivationRequestStatus.WAITING_ADMIN_APPROVAL,
              },
              include: { serviceOrder: true },
            });
          }
        }
        return existing;
      }

      const now = new Date();
      const quote = await tx.recommendationQuote.findUnique({
        where: { id: input.quoteId },
        include: {
          plan: true,
          session: true,
          serviceOrder: { include: { activationRequest: true } },
        },
      });
      if (
        !quote ||
        quote.session.userId !== input.userId ||
        quote.productKind !== InfrastructureProductKind.CLOUD_SERVER ||
        (quote.status !== RecommendationQuoteStatus.ACTIVE &&
          quote.status !== RecommendationQuoteStatus.SELECTED) ||
        quote.expiresAt <= now ||
        quote.session.expiresAt <= now
      ) {
        throw new WalletError(
          "quote_expired",
          "Estimate منقضی شده است؛ منابع را دوباره قیمت‌گذاری کنید.",
        );
      }
      if (quote.serviceOrder?.activationRequest) {
        return quote.serviceOrder.activationRequest;
      }
      if (quote.serviceOrder) {
        throw new WalletError(
          "direct_checkout_not_allowed",
          "سرور ابری PAYG از مسیر مستقیم خریداری نمی‌شود.",
        );
      }
      assertPublicSaleEnabled({
        provider: quote.plan.provider,
        productKind: quote.plan.productKind,
        offerSource: quote.plan.offerSource,
      });
      if (
        quote.plan.provider === InfrastructureProvider.ARVAN &&
        quote.plan.offerSource === "API_CATALOG"
      ) {
        const regionSaleEnabled =
          await tx.providerRegionConfig.findFirst({
            where: {
              provider: quote.plan.provider,
              apiVersion: quote.plan.providerApiVersion,
              regionCode: quote.plan.regionCode,
              saleEnabled: true,
            },
            select: { id: true },
          });
        if (!regionSaleEnabled) {
          throw new WalletError(
            "provider_sale_disabled",
            "فروش عمومی این موقعیت موقتاً غیرفعال است؛ مبلغی برداشت نشد.",
          );
        }
      }
      const estimate = await estimateForQuote(quote, input.cadence, tx);
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: input.userId },
      });
      const status =
        wallet.availableBalance >= estimate.billingSnapshot.minimumCreditRial
          ? ActivationRequestStatus.WAITING_ADMIN_APPROVAL
          : ActivationRequestStatus.CREDIT_REQUIRED;
      const serviceOrder = await tx.serviceOrder.create({
        data: {
          userId: input.userId,
          title: quote.plan.title,
          description: quote.plan.description,
          amount: 0n,
          currency: "IRR",
          status: ServiceOrderStatus.ACTIVATION_REQUESTED,
          planCode: quote.plan.code,
          planId: quote.plan.id,
          planSnapshot: quote.planSnapshot as Prisma.InputJsonValue,
          recommendationQuoteId: quote.id,
          quoteExpiresAt: quote.expiresAt,
          provider: quote.plan.provider,
          providerApiVersion: quote.plan.providerApiVersion,
          productKind: quote.plan.productKind,
          parchinLevel: quote.parchinLevel,
          productFlowState: "QUOTED",
          productFlowRevision: quote.session.productFlowRevision,
        },
      });
      const activation = await tx.activationRequest.create({
        data: {
          userId: input.userId,
          serviceOrderId: serviceOrder.id,
          planId: quote.plan.id,
          billingPolicyVersionId: estimate.policy.id,
          selectedCadence: input.cadence,
          status,
          estimatedHourlyRial: estimate.hourlyEstimateRial,
          estimatedDailyRial: estimate.dailyEstimateRial,
          oneTimeChargesRial: estimate.oneTimeChargesRial,
          minimumCreditRequiredRial:
            estimate.billingSnapshot.minimumCreditRial,
          estimateSnapshot: {
            requestFingerprint: fingerprint,
            quoteId: quote.id,
            provider: quote.plan.provider,
            providerApiVersion: quote.plan.providerApiVersion,
            productKind: quote.plan.productKind,
            externalPlanId: quote.externalPlanId,
            region: quote.providerRegion,
            providerHourlyRial:
              estimate.providerHourlyRial.toString(),
            markupBasisPoints: estimate.markupBasisPoints,
            markupHourlyRial: estimate.markupHourlyRial.toString(),
            hourlyEstimateRial:
              estimate.hourlyEstimateRial.toString(),
            dailyEstimateRial: estimate.dailyEstimateRial.toString(),
            oneTimeChargesRial:
              estimate.oneTimeChargesRial.toString(),
            billingPolicyVersionId: estimate.policy.id,
            billingSnapshot: {
              ...estimate.billingSnapshot,
              hourlyEstimateRial:
                estimate.billingSnapshot.hourlyEstimateRial?.toString() ??
                null,
              dailyEstimateRial:
                estimate.billingSnapshot.dailyEstimateRial?.toString() ??
                null,
              minimumCreditRial:
                estimate.billingSnapshot.minimumCreditRial.toString(),
            },
            currency: "IRR",
            estimated: true,
          },
          idempotencyKey: input.idempotencyKey,
        },
        include: { serviceOrder: true },
      });
      await tx.recommendationQuote.update({
        where: { id: quote.id },
        data: {
          status: RecommendationQuoteStatus.SELECTED,
          selectedAt: quote.selectedAt ?? now,
        },
      });
      await tx.recommendationSession.update({
        where: { id: quote.sessionId },
        data: { status: RecommendationFlowStatus.CHECKOUT },
      });
      await transitionProductFlowTx(tx, {
        owner: {
          recommendationSessionId: quote.sessionId,
          serviceOrderId: serviceOrder.id,
        },
        from: "QUOTED",
        to: "ACTIVATION_REQUESTED",
        reason: "wallet_first_activation_requested",
        idempotencyKey: `activation-flow:${activation.id}`,
        actorUserId: input.userId,
      });
      await writeAuditLog(
        {
          actorUserId: input.userId,
          action: AuditActions.ACTIVATION_REQUESTED,
          entityType: "activation_request",
          entityId: activation.id,
          afterData: {
            status,
            selectedCadence: input.cadence,
            minimumCreditRequiredRial:
              estimate.billingSnapshot.minimumCreditRial.toString(),
            containsSecret: false,
          },
          idempotencyKey: `audit:activation-requested:${activation.id}`,
        },
        tx,
      );
      return activation;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function approveActivation(input: {
  activationRequestId: string;
  adminUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "ActivationRequest"
        WHERE id = ${input.activationRequestId}
        FOR UPDATE
      `;
      await assertAdminActorTx(tx, input.adminUserId);
      const activation = await tx.activationRequest.findUnique({
        where: { id: input.activationRequestId },
        include: {
          user: { include: { wallet: true } },
          plan: { include: { catalogItem: true } },
          serviceOrder: {
            include: { recommendationQuote: true },
          },
          infrastructureOrder: true,
        },
      });
      if (!activation) {
        throw new WalletError(
          "not_found",
          "درخواست فعال‌سازی پیدا نشد.",
        );
      }
      const infrastructureOrderId =
        activation.infrastructureOrder?.id ?? randomUUID();
      const command = normalizeAdminCommand({
        operation: "APPROVE_PROVISION",
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.adminUserId,
        infrastructureOrderId,
        serviceOrderId: activation.serviceOrderId,
        reason: input.reason,
        payload: { activationRequestId: activation.id },
      });
      const replay = await replayAdminCommandTx(tx, command);
      if (replay) return replay;
      if (
        activation.status !==
          ActivationRequestStatus.WAITING_ADMIN_APPROVAL ||
        activation.infrastructureOrder
      ) {
        throw new WalletError(
          "invalid_status",
          "این درخواست در صف تأیید اول نیست.",
        );
      }
      if (
        !activation.user.wallet ||
        activation.user.wallet.availableBalance <
          activation.minimumCreditRequiredRial
      ) {
        await tx.activationRequest.update({
          where: { id: activation.id },
          data: { status: ActivationRequestStatus.CREDIT_REQUIRED },
        });
        throw new WalletError(
          "insufficient_credit",
          "اعتبار Wallet برای Buffer فعال‌سازی کافی نیست.",
        );
      }
      const quote = activation.serviceOrder.recommendationQuote;
      if (!quote) {
        throw new WalletError(
          "estimate_snapshot_missing",
          "Snapshot فعال‌سازی کامل نیست.",
        );
      }
      assertPublicSaleEnabled({
        provider: activation.plan.provider,
        productKind: activation.plan.productKind,
        offerSource: activation.plan.offerSource,
      });
      if (activation.plan.offerSource === "API_CATALOG") {
        const [catalogState, regionSaleEnabled] = await Promise.all([
          tx.providerCatalogState.findUnique({
            where: { provider: activation.plan.provider },
          }),
          tx.providerRegionConfig.findFirst({
            where: {
              provider: activation.plan.provider,
              apiVersion: activation.plan.providerApiVersion,
              regionCode: activation.plan.regionCode,
              saleEnabled: true,
            },
            select: { id: true },
          }),
        ]);
        const catalogItem = activation.plan.catalogItem;
        const lastSync = catalogState?.lastCatalogSync;
        const fresh =
          catalogState?.lastSyncStatus === "SUCCEEDED" &&
          lastSync != null &&
          Date.now() - lastSync.getTime() <=
            (catalogState.freshnessSlaSeconds ?? 900) * 1000;
        if (
          !regionSaleEnabled ||
          !fresh ||
          !catalogItem ||
          activation.plan.catalogItemId !== quote.catalogItemId ||
          catalogItem.id !== quote.catalogItemId ||
          activation.plan.provider !== quote.provider ||
          activation.plan.providerApiVersion !==
            quote.providerApiVersion ||
          activation.plan.productKind !== quote.productKind ||
          activation.plan.regionCode !== quote.providerRegion ||
          (catalogItem.externalPlanId ??
            activation.plan.sizeCode) !== quote.externalPlanId ||
          catalogItem.status !== "ACTIVE" ||
          !catalogItem.available ||
          catalogItem.providerHourlyPriceIrr == null ||
          catalogItem.providerHourlyPriceIrr <= 0n ||
          catalogItem.providerMonthlyPriceIrr == null ||
          catalogItem.providerMonthlyPriceIrr <= 0n ||
          catalogItem.providerHourlyPriceIrr !==
            quote.providerHourlyPriceIrr ||
          catalogItem.providerMonthlyPriceIrr !==
            quote.providerMonthlyPriceIrr ||
          catalogItem.payloadHash !== quote.providerPayloadHash
        ) {
          throw new WalletError(
            "quote_revalidation_failed",
            "قیمت یا وضعیت Provider از زمان Estimate تغییر کرده است؛ تأیید Provision متوقف شد.",
          );
        }
      }
      const providerBillingContract = await getEffectiveProviderBillingContract(
        {
          provider: activation.plan.provider,
          providerApiVersion: activation.plan.providerApiVersion,
          productKind: activation.plan.productKind,
        },
        tx,
      );
      requireVerifiedProviderBillingContract(providerBillingContract);
      const providerBillingContractSnapshot = serializeProviderBillingContract(
        providerBillingContract!,
      );
      const infra = await tx.infrastructureOrder.create({
        data: {
          id: infrastructureOrderId,
          serviceOrderId: activation.serviceOrderId,
          userId: activation.userId,
          planId: activation.planId,
          provider: activation.plan.provider,
          providerApiVersion: activation.plan.providerApiVersion,
          productKind: activation.plan.productKind,
          parchinLevel: activation.serviceOrder.parchinLevel,
          providerSelectionSnapshot: {
            provider: activation.plan.provider,
            providerApiVersion:
              activation.plan.providerApiVersion,
            productKind: activation.plan.productKind,
            offerSource: activation.plan.offerSource,
            catalogItemId: activation.plan.catalogItemId,
            region: activation.plan.regionCode,
            externalPlanId:
              quote.externalPlanId ??
              activation.plan.catalogItem?.externalPlanId ??
              activation.plan.sizeCode,
            externalImageId:
              quote.externalImageId ?? activation.plan.imageCode,
            externalNetworkId: quote.externalNetworkId,
            externalSecurityId: quote.externalSecurityId,
            topologyVerificationMode:
              activation.plan.provider === "PARSPACK"
                ? "PROVIDER_MANAGED"
                : "STRICT_OBSERVED",
            deliveryConfiguration:
              quote.deliveryConfigurationSnapshot,
            parchinLevel: activation.serviceOrder.parchinLevel,
            preprovisionedInventoryItemId:
              quote.preprovisionedInventoryItemId,
          },
          deliveryMode: activation.plan.deliveryMode,
          status: InfrastructureOrderStatus.FUNDING_CONFIRMED,
          requiredFundingRial: 0n,
          desiredInstanceName: `abrchin-${activation.serviceOrderId.slice(-12)}-1`,
          productFlowState: "ACTIVATION_REQUESTED",
          productFlowRevision:
            activation.serviceOrder.productFlowRevision,
          preprovisionedInventoryItemId:
            activation.plan.offerSource ===
            InfrastructureOfferSource.PREPROVISIONED_INVENTORY
              ? quote.preprovisionedInventoryItemId
              : null,
        },
      });
      await transitionProductFlowTx(tx, {
        owner: {
          recommendationSessionId: quote.sessionId,
          serviceOrderId: activation.serviceOrderId,
          infrastructureOrderId: infra.id,
        },
        from: "ACTIVATION_REQUESTED",
        to: "PROVISION_APPROVED",
        reason: "admin_activation_approved",
        idempotencyKey: `activation-approved:${activation.id}`,
        actorUserId: input.adminUserId,
      });
      await tx.activationRequest.update({
        where: { id: activation.id },
        data: {
          status: ActivationRequestStatus.APPROVED,
          infrastructureOrderId: infra.id,
          providerBillingContractSnapshot:
            providerBillingContractSnapshot as Prisma.InputJsonValue,
          firstApprovedAt: new Date(),
          firstApprovedById: input.adminUserId,
        },
      });
      const result = {
        activationRequestId: activation.id,
        serviceOrderId: activation.serviceOrderId,
        infrastructureOrderId: infra.id,
        status: ActivationRequestStatus.APPROVED,
        approved: true,
        providerMutationExecuted: false,
        containsSecret: false,
      };
      await writeAuditLog(
        {
          actorUserId: input.adminUserId,
          action: AuditActions.ACTIVATION_APPROVED,
          entityType: "activation_request",
          entityId: activation.id,
          afterData: result,
          ip: input.ip,
          userAgent: input.userAgent,
          idempotencyKey: `audit:${command.receiptKey}`,
        },
        tx,
      );
      await persistAdminCommandReceiptTx(tx, command, result);
      return result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
