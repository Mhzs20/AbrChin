/**
 * Priced server upgrade quotes with 60-minute customer lock + wallet debit.
 *
 * Commercial principles mirror purchase quotes:
 * - Locked customer charge for RECOMMENDATION_QUOTE_VALIDITY_MS
 * - Wallet top-up does not extend TTL
 * - Provider availability may block; price rise alone must not increase charge
 * - Debit before any provider mutation / admin fulfill
 * - Idempotent debit; never double-charge
 */

import {
  CloudInstanceStatus,
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  Prisma,
  ProductBillingModel,
  ResourceChangeStatus,
  ServiceOrderStatus,
  WalletStatus,
} from "@prisma/client";

import { postPrepaidUpgradeCharge } from "@/lib/accounting/posting";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  calculateMarkupRial,
  calculateResourceChangeBufferRial,
} from "@/lib/billing/policy";
import { getEffectiveBillingPolicy } from "@/lib/billing/policy-service";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatTomanFa } from "@/lib/money";
import {
  pricingConfigs,
  resolveConfiguredPlanPricing,
} from "@/lib/orders/plans";
import {
  computePrepaidUpgradeCharge,
  serializePrepaidUpgradeCharge,
} from "@/lib/orders/prepaid-upgrade";
import { RECOMMENDATION_QUOTE_VALIDITY_MS } from "@/lib/recommendation/quote-service";
import { calculateWalletShortfallRial } from "@/lib/wallet/topup-limits";
import {
  ensureWalletForUser,
  getWalletForUser,
} from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";

export const UPGRADE_QUOTE_KIND = "upgrade_quote" as const;

export type UpgradeResourceShape = {
  vcpu: number;
  ramGb: number;
  diskGb: number;
};

export type UpgradeTargetOffer = UpgradeResourceShape & {
  planId: string;
  planTitle: string;
  sizeCode: string;
  code: string;
  upgradeChargeRial: bigint;
  available: boolean;
};

export type UpgradeSnapshot = {
  kind: typeof UPGRADE_QUOTE_KIND;
  version: 1;
  action: "UPGRADE";
  billingModel: "PREPAID_TERM" | "PAYG_WALLET";
  expiresAt: string;
  quotedAt: string;
  lockedUpgradeChargeRial: string;
  current: UpgradeResourceShape & {
    planId: string;
    planTitle: string;
  };
  target: UpgradeResourceShape & {
    planId: string;
    planTitle: string;
    sizeCode: string;
    code: string;
  };
  delta: UpgradeResourceShape;
  prepaid?: ReturnType<typeof serializePrepaidUpgradeCharge>;
  payg?: {
    cadence: string;
    currentHourlyEstimateRial: string;
    targetHourlyEstimateRial: string;
    currentDailyEstimateRial: string;
    targetDailyEstimateRial: string;
  };
  financial?: {
    walletDebitedAt: string;
    ledgerIdempotencyKey: string;
    ledgerEntryId: string;
    amountRial: string;
  };
  providerMutationExecuted: boolean;
  note?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseUpgradeQuoteSnapshot(
  value: unknown,
): UpgradeSnapshot | null {
  const raw = asRecord(value);
  if (!raw || raw.kind !== UPGRADE_QUOTE_KIND || raw.version !== 1) {
    return null;
  }
  return raw as unknown as UpgradeSnapshot;
}

export function upgradeDebitIdempotencyKey(resourceChangeRequestId: string) {
  return `resource_change_upgrade_debit_${resourceChangeRequestId}`;
}

export function isStrictResourceUpgrade(
  current: UpgradeResourceShape,
  target: UpgradeResourceShape,
): boolean {
  return (
    target.vcpu >= current.vcpu &&
    target.ramGb >= current.ramGb &&
    target.diskGb >= current.diskGb &&
    (target.vcpu > current.vcpu ||
      target.ramGb > current.ramGb ||
      target.diskGb > current.diskGb)
  );
}

function resourceShapeFromPlan(plan: {
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
}): UpgradeResourceShape | null {
  if (
    plan.vcpu == null ||
    plan.ramGb == null ||
    plan.storageGb == null ||
    plan.vcpu <= 0 ||
    plan.ramGb <= 0 ||
    plan.storageGb < 0
  ) {
    return null;
  }
  return {
    vcpu: plan.vcpu,
    ramGb: plan.ramGb,
    diskGb: plan.storageGb,
  };
}

function mutationsEnabledFor(provider: "ARVAN" | "PARSPACK") {
  const env = getEnv();
  return provider === "ARVAN"
    ? env.arvanMutationsEnabled === true
    : env.parspackMutationsEnabled === true;
}

/**
 * Provider API resize capability for Launch upgrades.
 *
 * "Valid upgrade target" means a published, strictly-larger AbrChin plan in the
 * same provider/region that Admin can fulfill — not a live provider catalog
 * probe. Arvan exposes a real resize API (`flavor_id` server action) when
 * ARVAN_MUTATIONS_ENABLED; otherwise Admin fulfills manually after the same
 * two gates. ParsPack has no resize API (adapter returns unsupported) and is
 * always manual-fulfillment. Do not fabricate provider capability beyond this.
 */
export function providerResizeCapability(provider: "ARVAN" | "PARSPACK") {
  if (provider === "PARSPACK") {
    return {
      apiResizeSupported: false,
      manualFulfillmentRequired: true,
      mutationsEnabled: mutationsEnabledFor(provider),
    };
  }
  return {
    apiResizeSupported: true,
    manualFulfillmentRequired: !mutationsEnabledFor(provider),
    mutationsEnabled: mutationsEnabledFor(provider),
  };
}

async function loadUpgradeContext(instanceId: string, userId: string) {
  const instance = await prisma.cloudInstance.findFirst({
    where: { id: instanceId, userId },
    include: {
      subscription: true,
      resourceVersions: {
        where: { effectiveTo: null },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
      billingPolicySnapshots: {
        where: {
          effectiveTo: null,
        },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
      infrastructureOrder: {
        include: {
          serviceOrder: true,
          plan: { include: { catalogItem: true } },
        },
      },
    },
  });
  if (!instance) {
    throw new WalletError("not_found", "سرور پیدا نشد.");
  }
  if (instance.status !== CloudInstanceStatus.ACTIVE) {
    throw new WalletError(
      "upgrade_not_eligible",
      "ارتقا فقط برای سرور فعال ممکن است.",
    );
  }
  const plan = instance.infrastructureOrder.plan;
  const order = instance.infrastructureOrder.serviceOrder;
  if (order.status !== ServiceOrderStatus.PAID) {
    throw new WalletError(
      "upgrade_not_eligible",
      "فقط سفارش پرداخت‌شده قابل ارتقا است.",
    );
  }
  const currentFromVersion = instance.resourceVersions[0];
  const current: UpgradeResourceShape | null = currentFromVersion
    ? {
        vcpu: currentFromVersion.vcpu,
        ramGb: Math.ceil(currentFromVersion.ramMb / 1024),
        diskGb: currentFromVersion.diskGb,
      }
    : resourceShapeFromPlan(plan);
  if (!current) {
    throw new WalletError(
      "upgrade_resources_unknown",
      "منابع فعلی سرور برای ارتقا مشخص نیست.",
    );
  }
  return {
    instance,
    plan,
    order,
    subscription: instance.subscription,
    current,
    sourceResourceVersionId: currentFromVersion?.id ?? null,
    billingSnapshot: instance.billingPolicySnapshots[0] ?? null,
  };
}

type ChargeResult = {
  chargeRial: bigint;
  available: boolean;
  prepaid?: ReturnType<typeof serializePrepaidUpgradeCharge>;
  payg?: UpgradeSnapshot["payg"];
  targetShape: UpgradeResourceShape;
};

async function computeChargeForTarget(input: {
  billingModel: ProductBillingModel;
  orderAmount: bigint;
  termMonths: number;
  serviceStartedAt: Date;
  parchinLevel: "PARCHIN_START" | "PARCHIN_ACTIVE" | "PARCHIN_STABLE" | null;
  current: UpgradeResourceShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetPlan: any;
  billingSnapshot: {
    cadence: "HOURLY" | "DAILY";
    hourlyEstimateRial: bigint | null;
    dailyEstimateRial: bigint | null;
  } | null;
  asOf?: Date;
}): Promise<ChargeResult> {
  const targetShape = resourceShapeFromPlan(input.targetPlan);
  if (!targetShape || !isStrictResourceUpgrade(input.current, targetShape)) {
    throw new WalletError(
      "invalid_upgrade_target",
      "منابع مقصد ارتقای معتبر نیست (فقط افزایش مجاز است).",
    );
  }

  const catalogOk =
    !input.targetPlan.catalogItem ||
    (input.targetPlan.catalogItem.active &&
      input.targetPlan.catalogItem.available);

  if (input.billingModel === ProductBillingModel.PAYG_WALLET) {
    if (!input.billingSnapshot) {
      throw new WalletError(
        "billing_snapshot_missing",
        "قرارداد صورتحساب فعال برای ارتقای PAYG پیدا نشد.",
      );
    }
    const configs = await pricingConfigs();
    const providerCfg = configs.providers.find(
      (c) => c.provider === input.targetPlan.provider,
    );
    const productCfg = configs.products.find(
      (c) =>
        c.provider === input.targetPlan.provider &&
        c.productKind === input.targetPlan.productKind,
    );
    const providerHourly =
      input.targetPlan.catalogItem?.providerHourlyPriceIrr ?? null;
    if (
      providerHourly == null ||
      providerHourly <= 0n ||
      !providerCfg ||
      !productCfg
    ) {
      throw new WalletError(
        "hourly_estimate_unavailable",
        "نرخ ساعتی مقصد برای ارتقا در دسترس نیست.",
      );
    }
    const markupBps =
      providerCfg.markupBasisPoints + productCfg.markupBasisPoints;
    const targetHourly =
      providerHourly + calculateMarkupRial(providerHourly, markupBps);
    const targetDaily = targetHourly * 24n;
    const currentHourly = input.billingSnapshot.hourlyEstimateRial ?? 0n;
    const currentDaily =
      input.billingSnapshot.dailyEstimateRial ?? currentHourly * 24n;
    const policy = await getEffectiveBillingPolicy(input.targetPlan.id);
    const buffer = calculateResourceChangeBufferRial({
      policy: {
        availability: policy.availability,
        defaultCadence: policy.defaultCadence,
        displayMode: policy.displayMode,
        hourlyMinimumCreditHours: policy.hourlyMinimumCreditHours,
        dailyMinimumCreditDays: policy.dailyMinimumCreditDays,
        hourlyGracePeriods: policy.hourlyGracePeriods,
        dailyGracePeriods: policy.dailyGracePeriods,
        lowBalanceThresholdPeriods: policy.lowBalanceThresholdPeriods,
      },
      cadence: input.billingSnapshot.cadence,
      currentHourlyEstimateRial: currentHourly,
      targetHourlyEstimateRial: targetHourly,
      currentDailyEstimateRial: currentDaily,
      targetDailyEstimateRial: targetDaily,
    });
    if (buffer <= 0n) {
      throw new WalletError(
        "upgrade_charge_non_positive",
        "مبلغ ارتقا باید مثبت باشد.",
      );
    }
    return {
      chargeRial: buffer,
      available: catalogOk,
      targetShape,
      payg: {
        cadence: input.billingSnapshot.cadence,
        currentHourlyEstimateRial: currentHourly.toString(),
        targetHourlyEstimateRial: targetHourly.toString(),
        currentDailyEstimateRial: currentDaily.toString(),
        targetDailyEstimateRial: targetDaily.toString(),
      },
    };
  }

  const termMonths =
    input.termMonths === 3 ||
    input.termMonths === 6 ||
    input.termMonths === 12
      ? input.termMonths
      : 1;
  const configs = await pricingConfigs();
  const priced = resolveConfiguredPlanPricing(
    input.targetPlan,
    configs,
    input.parchinLevel ?? undefined,
    { termMonths },
  );
  if (!priced) {
    throw new WalletError(
      "target_price_unavailable",
      "قیمت تجاری منابع مقصد در دسترس نیست.",
    );
  }
  const preview = computePrepaidUpgradeCharge({
    originalPaidRial: input.orderAmount,
    newFullTermPriceRial: priced.finalPriceRial,
    termMonths,
    serviceStartedAt: input.serviceStartedAt,
    asOf: input.asOf,
  });
  if (preview.upgradeChargeRial <= 0n) {
    throw new WalletError(
      "upgrade_charge_non_positive",
      "برای این مقصد مبلغ ارتقای مثبت محاسبه نشد.",
    );
  }
  return {
    chargeRial: preview.upgradeChargeRial,
    available: catalogOk && priced.available !== false,
    targetShape,
    prepaid: serializePrepaidUpgradeCharge(preview),
  };
}

export async function listUpgradeTargetsForInstance(input: {
  instanceId: string;
  userId: string;
}) {
  const ctx = await loadUpgradeContext(input.instanceId, input.userId);
  const wallet = await getWalletForUser(input.userId);
  const walletBalanceRial = wallet?.availableBalance ?? 0n;
  const capability = providerResizeCapability(ctx.instance.provider);

  const candidates = await prisma.infrastructurePlan.findMany({
    where: {
      active: true,
      publicationStatus: "PUBLISHED",
      deliveryMode: "MANAGED",
      provider: ctx.plan.provider,
      providerApiVersion: ctx.plan.providerApiVersion,
      productKind: ctx.plan.productKind,
      regionCode: ctx.plan.regionCode,
      id: { not: ctx.plan.id },
      OR: [
        { vcpu: { gt: ctx.current.vcpu } },
        { ramGb: { gt: ctx.current.ramGb } },
        { storageGb: { gt: ctx.current.diskGb } },
      ],
    },
    include: { catalogItem: true },
    orderBy: [{ vcpu: "asc" }, { ramGb: "asc" }, { storageGb: "asc" }],
  });

  const serviceStartedAt =
    ctx.subscription?.currentPeriodStart ??
    ctx.instance.deliveredAt ??
    ctx.instance.provisionedAt ??
    ctx.order.paidAt ??
    ctx.order.createdAt;
  const termMonths =
    ctx.subscription?.termMonths || ctx.order.termMonths || 1;
  const parchinLevel =
    ctx.subscription?.parchinLevel ??
    ctx.order.parchinLevel ??
    ctx.plan.minimumParchinLevel ??
    null;

  const targets: UpgradeTargetOffer[] = [];
  for (const candidate of candidates) {
    const shape = resourceShapeFromPlan(candidate);
    if (!shape || !isStrictResourceUpgrade(ctx.current, shape)) continue;
    try {
      const priced = await computeChargeForTarget({
        billingModel: ctx.plan.billingModel,
        orderAmount: ctx.order.amount,
        termMonths,
        serviceStartedAt,
        parchinLevel,
        current: ctx.current,
        targetPlan: candidate,
        billingSnapshot: ctx.billingSnapshot,
      });
      targets.push({
        planId: candidate.id,
        planTitle: candidate.title,
        sizeCode: candidate.sizeCode,
        code: candidate.code,
        ...shape,
        upgradeChargeRial: priced.chargeRial,
        available: priced.available,
      });
    } catch {
      // Skip targets that cannot be priced under authoritative policy.
    }
  }

  return {
    instanceId: ctx.instance.id,
    serverName: ctx.instance.name,
    orderId: ctx.order.id,
    billingModel: ctx.plan.billingModel,
    current: {
      planId: ctx.plan.id,
      planTitle: ctx.plan.title,
      ...ctx.current,
    },
    targets,
    walletBalanceRial,
    providerCapability: capability,
    quoteValidityMs: RECOMMENDATION_QUOTE_VALIDITY_MS,
  };
}

export async function createUpgradeQuote(input: {
  instanceId: string;
  userId: string;
  targetPlanId: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const ctx = await loadUpgradeContext(input.instanceId, input.userId);
  const targetPlan = await prisma.infrastructurePlan.findFirst({
    where: {
      id: input.targetPlanId,
      active: true,
      publicationStatus: "PUBLISHED",
      deliveryMode: "MANAGED",
      provider: ctx.plan.provider,
      providerApiVersion: ctx.plan.providerApiVersion,
      productKind: ctx.plan.productKind,
      regionCode: ctx.plan.regionCode,
    },
    include: { catalogItem: true },
  });
  if (!targetPlan) {
    throw new WalletError(
      "invalid_upgrade_target",
      "پلن مقصد ارتقا پیدا نشد یا قابل انتخاب نیست.",
    );
  }

  const serviceStartedAt =
    ctx.subscription?.currentPeriodStart ??
    ctx.instance.deliveredAt ??
    ctx.instance.provisionedAt ??
    ctx.order.paidAt ??
    ctx.order.createdAt;
  const termMonths =
    ctx.subscription?.termMonths || ctx.order.termMonths || 1;
  const parchinLevel =
    ctx.subscription?.parchinLevel ??
    ctx.order.parchinLevel ??
    ctx.plan.minimumParchinLevel ??
    null;

  const priced = await computeChargeForTarget({
    billingModel: ctx.plan.billingModel,
    orderAmount: ctx.order.amount,
    termMonths,
    serviceStartedAt,
    parchinLevel,
    current: ctx.current,
    targetPlan,
    billingSnapshot: ctx.billingSnapshot,
  });
  if (!priced.available) {
    throw new WalletError(
      "target_unavailable",
      "منابع مقصد فعلاً در دسترس نیست.",
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RECOMMENDATION_QUOTE_VALIDITY_MS);
  const snapshot: UpgradeSnapshot = {
    kind: UPGRADE_QUOTE_KIND,
    version: 1,
    action: "UPGRADE",
    billingModel:
      ctx.plan.billingModel === ProductBillingModel.PAYG_WALLET
        ? "PAYG_WALLET"
        : "PREPAID_TERM",
    expiresAt: expiresAt.toISOString(),
    quotedAt: now.toISOString(),
    lockedUpgradeChargeRial: priced.chargeRial.toString(),
    current: {
      planId: ctx.plan.id,
      planTitle: ctx.plan.title,
      ...ctx.current,
    },
    target: {
      planId: targetPlan.id,
      planTitle: targetPlan.title,
      sizeCode: targetPlan.sizeCode,
      code: targetPlan.code,
      ...priced.targetShape,
    },
    delta: {
      vcpu: priced.targetShape.vcpu - ctx.current.vcpu,
      ramGb: priced.targetShape.ramGb - ctx.current.ramGb,
      diskGb: priced.targetShape.diskGb - ctx.current.diskGb,
    },
    prepaid: priced.prepaid,
    payg: priced.payg,
    providerMutationExecuted: false,
  };

  const idempotencyKey = `customer-upgrade-quote:${ctx.instance.id}:${targetPlan.id}:${input.userId}`;

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.resourceChangeRequest.findUnique({
      where: { idempotencyKey },
    });
    if (existing && existing.status === ResourceChangeStatus.REQUESTED) {
      const existingSnap = parseUpgradeQuoteSnapshot(existing.estimateSnapshot);
      if (
        existingSnap &&
        new Date(existingSnap.expiresAt).getTime() > now.getTime()
      ) {
        return { request: existing, reused: true as const };
      }
    }

    // Cancel other unpaid upgrade quotes for this instance.
    const openQuotes = await tx.resourceChangeRequest.findMany({
      where: {
        cloudInstanceId: ctx.instance.id,
        requestedById: input.userId,
        status: ResourceChangeStatus.REQUESTED,
      },
    });
    for (const open of openQuotes) {
      const snap = parseUpgradeQuoteSnapshot(open.estimateSnapshot);
      if (snap) {
        await tx.resourceChangeRequest.update({
          where: { id: open.id },
          data: { status: ResourceChangeStatus.CANCELED },
        });
      }
    }

    const key = existing
      ? `${idempotencyKey}:${now.getTime()}`
      : idempotencyKey;

    const request = await tx.resourceChangeRequest.create({
      data: {
        cloudInstanceId: ctx.instance.id,
        planId: targetPlan.id,
        requestedById: input.userId,
        sourceResourceVersionId: ctx.sourceResourceVersionId,
        requestedResources: {
          action: "UPGRADE",
          source: "CUSTOMER_UPGRADE_QUOTE",
          providerMutationExecuted: false,
          current: snapshot.current,
          target: snapshot.target,
          delta: snapshot.delta,
        },
        estimateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        incrementalBufferRial: priced.chargeRial,
        status: ResourceChangeStatus.REQUESTED,
        idempotencyKey: key,
      },
    });

    await writeAuditLog(
      {
        actorUserId: input.userId,
        action: AuditActions.RESOURCE_CHANGE_REQUESTED,
        entityType: "ResourceChangeRequest",
        entityId: request.id,
        afterData: {
          action: "UPGRADE",
          lockedUpgradeChargeRial: snapshot.lockedUpgradeChargeRial,
          expiresAt: snapshot.expiresAt,
          targetPlanId: targetPlan.id,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        idempotencyKey: `audit:upgrade-quote:${request.id}`,
      },
      tx,
    );

    return { request, reused: false as const };
  });

  const wallet = await ensureWalletForUser(input.userId);
  return serializeUpgradeQuoteView({
    request: created.request,
    walletBalanceRial: wallet.availableBalance,
    reused: created.reused,
  });
}

export function serializeUpgradeQuoteView(input: {
  request: {
    id: string;
    status: ResourceChangeStatus;
    incrementalBufferRial: bigint;
    estimateSnapshot: Prisma.JsonValue;
    cloudInstanceId: string;
    planId: string;
    requestedAt: Date;
  };
  walletBalanceRial: bigint;
  reused?: boolean;
}) {
  const snap = parseUpgradeQuoteSnapshot(input.request.estimateSnapshot);
  if (!snap) {
    throw new WalletError(
      "invalid_upgrade_quote",
      "پیش‌فاکتور ارتقا معتبر نیست.",
    );
  }
  const locked = BigInt(snap.lockedUpgradeChargeRial);
  const expiresAt = new Date(snap.expiresAt);
  const expired =
    input.request.status === ResourceChangeStatus.REQUESTED &&
    expiresAt.getTime() <= Date.now();
  const paid = Boolean(snap.financial?.walletDebitedAt);
  const shortfall = calculateWalletShortfallRial(
    locked,
    input.walletBalanceRial,
  );
  const balanceAfter =
    !expired && shortfall === 0n
      ? input.walletBalanceRial - locked
      : null;

  return {
    id: input.request.id,
    instanceId: input.request.cloudInstanceId,
    status: input.request.status,
    reused: input.reused ?? false,
    expired,
    paid,
    expiresAt: snap.expiresAt,
    quotedAt: snap.quotedAt,
    billingModel: snap.billingModel,
    current: snap.current,
    target: snap.target,
    delta: snap.delta,
    upgradeChargeRial: locked.toString(),
    upgradeChargeTomanFa: formatTomanFa(locked),
    walletBalanceRial: input.walletBalanceRial.toString(),
    walletBalanceTomanFa: formatTomanFa(input.walletBalanceRial),
    walletBalanceAfterRial: balanceAfter?.toString() ?? null,
    walletBalanceAfterTomanFa:
      balanceAfter != null ? formatTomanFa(balanceAfter) : null,
    shortfallRial: shortfall.toString(),
    shortfallTomanFa: formatTomanFa(shortfall > 0n ? shortfall : 0n),
    prepaid: snap.prepaid ?? null,
    payg: snap.payg ?? null,
    financial: snap.financial ?? null,
    quoteValidityMs: RECOMMENDATION_QUOTE_VALIDITY_MS,
  };
}

export async function getUpgradeQuoteForCustomer(input: {
  resourceChangeRequestId: string;
  userId: string;
}) {
  const request = await prisma.resourceChangeRequest.findFirst({
    where: {
      id: input.resourceChangeRequestId,
      requestedById: input.userId,
    },
  });
  if (!request) {
    throw new WalletError("not_found", "پیش‌فاکتور ارتقا پیدا نشد.");
  }
  const snap = parseUpgradeQuoteSnapshot(request.estimateSnapshot);
  if (!snap) {
    throw new WalletError(
      "invalid_upgrade_quote",
      "این درخواست یک پیش‌فاکتور ارتقا نیست.",
    );
  }
  const wallet = await getWalletForUser(input.userId);
  return serializeUpgradeQuoteView({
    request,
    walletBalanceRial: wallet?.availableBalance ?? 0n,
  });
}

export async function payUpgradeQuoteWithWallet(input: {
  resourceChangeRequestId: string;
  userId: string;
  idempotencyKey?: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const existingLedgerKey = upgradeDebitIdempotencyKey(
    input.resourceChangeRequestId,
  );
  const priorLedger = await prisma.walletLedgerEntry.findUnique({
    where: { idempotencyKey: existingLedgerKey },
  });
  if (priorLedger && priorLedger.status === LedgerStatus.COMPLETED) {
    const request = await prisma.resourceChangeRequest.findFirstOrThrow({
      where: {
        id: input.resourceChangeRequestId,
        requestedById: input.userId,
      },
    });
    const wallet = await ensureWalletForUser(input.userId);
    return {
      reused: true as const,
      view: serializeUpgradeQuoteView({
        request,
        walletBalanceRial: wallet.availableBalance,
      }),
      ledgerEntryId: priorLedger.id,
    };
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "ResourceChangeRequest"
        WHERE id = ${input.resourceChangeRequestId}
        FOR UPDATE
      `;
      const request = await tx.resourceChangeRequest.findFirst({
        where: {
          id: input.resourceChangeRequestId,
          requestedById: input.userId,
        },
        include: {
          cloudInstance: {
            include: {
              infrastructureOrder: {
                include: { serviceOrder: true, plan: true },
              },
              subscription: true,
            },
          },
          plan: { include: { catalogItem: true } },
        },
      });
      if (!request) {
        throw new WalletError("not_found", "پیش‌فاکتور ارتقا پیدا نشد.");
      }
      const snap = parseUpgradeQuoteSnapshot(request.estimateSnapshot);
      if (!snap) {
        throw new WalletError(
          "invalid_upgrade_quote",
          "پیش‌فاکتور ارتقا معتبر نیست.",
        );
      }
      if (snap.financial?.walletDebitedAt) {
        const wallet = await ensureWalletForUser(input.userId, tx);
        return {
          reused: true as const,
          view: serializeUpgradeQuoteView({
            request,
            walletBalanceRial: wallet.availableBalance,
          }),
          ledgerEntryId: snap.financial.ledgerEntryId,
        };
      }
      if (request.status !== ResourceChangeStatus.REQUESTED) {
        throw new WalletError(
          "invalid_status",
          "این پیش‌فاکتور دیگر قابل پرداخت نیست.",
        );
      }
      const expiresAt = new Date(snap.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        throw new WalletError(
          "quote_expired",
          "اعتبار قیمت ارتقا تمام شده؛ پیش‌فاکتور جدید لازم است. مبلغ شارژشده در کیف پول محفوظ است.",
        );
      }
      if (request.cloudInstance.status !== CloudInstanceStatus.ACTIVE) {
        throw new WalletError(
          "upgrade_not_eligible",
          "سرور دیگر فعال نیست؛ مبلغی برداشت نشد.",
        );
      }

      const targetShape = resourceShapeFromPlan(request.plan);
      const current = snap.current;
      if (
        !targetShape ||
        !isStrictResourceUpgrade(current, targetShape) ||
        request.plan.id !== snap.target.planId
      ) {
        throw new WalletError(
          "target_unavailable",
          "منابع مقصد دیگر معتبر نیست؛ مبلغی برداشت نشد.",
        );
      }
      if (
        request.plan.catalogItem &&
        (!request.plan.catalogItem.active ||
          !request.plan.catalogItem.available)
      ) {
        throw new WalletError(
          "target_unavailable",
          "ظرفیت مقصد ارتقا دیگر در دسترس نیست؛ مبلغی برداشت نشد.",
        );
      }

      // Price rise alone must not increase locked charge: debit the snapshot
      // amount, never a live reprice.
      const locked = BigInt(snap.lockedUpgradeChargeRial);
      if (locked <= 0n || locked !== request.incrementalBufferRial) {
        throw new WalletError(
          "invalid_upgrade_quote",
          "مبلغ قفل‌شده ارتقا نامعتبر است.",
        );
      }

      const wallet = await ensureWalletForUser(input.userId, tx);
      if (wallet.status !== WalletStatus.ACTIVE) {
        throw new WalletError("wallet_frozen", "کیف پول فعال نیست.");
      }
      const updated = await tx.wallet.updateMany({
        where: {
          id: wallet.id,
          availableBalance: { gte: locked },
          status: WalletStatus.ACTIVE,
        },
        data: { availableBalance: { decrement: locked } },
      });
      if (updated.count !== 1) {
        throw new WalletError("insufficient_funds", "موجودی کافی نیست.");
      }
      const freshWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });
      const ledgerKey = upgradeDebitIdempotencyKey(request.id);
      const ledger = await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          direction: LedgerDirection.DEBIT,
          type: LedgerType.SERVICE_PURCHASE,
          amount: locked,
          status: LedgerStatus.COMPLETED,
          referenceType: "resource_change_request",
          referenceId: request.id,
          idempotencyKey: ledgerKey,
          balanceAfter: freshWallet.availableBalance,
          description: `ارتقا سرور ${request.cloudInstance.name}`,
          metadata: {
            kind: "upgrade_quote",
            targetPlanId: snap.target.planId,
            lockedUpgradeChargeRial: locked.toString(),
          },
        },
      });

      const nextSnap: UpgradeSnapshot = {
        ...snap,
        financial: {
          walletDebitedAt: new Date().toISOString(),
          ledgerIdempotencyKey: ledgerKey,
          ledgerEntryId: ledger.id,
          amountRial: locked.toString(),
        },
      };

      const paid = await tx.resourceChangeRequest.updateMany({
        where: {
          id: request.id,
          status: ResourceChangeStatus.REQUESTED,
        },
        data: {
          status: ResourceChangeStatus.WAITING_ADMIN_APPROVAL,
          estimateSnapshot: nextSnap as unknown as Prisma.InputJsonValue,
          incrementalBufferRial: locked,
        },
      });
      if (paid.count !== 1) {
        throw new WalletError(
          "invalid_status",
          "این پیش‌فاکتور دیگر قابل پرداخت نیست.",
        );
      }

      await postPrepaidUpgradeCharge(
        {
          resourceChangeRequestId: request.id,
          amountRial: locked,
          ledgerEntryId: ledger.id,
          occurredAt: new Date(),
          billingModel: snap.billingModel,
        },
        tx,
      );

      await writeAuditLog(
        {
          actorUserId: input.userId,
          action: AuditActions.RESOURCE_CHANGE_REQUESTED,
          entityType: "ResourceChangeRequest",
          entityId: request.id,
          afterData: {
            action: "UPGRADE",
            paid: true,
            lockedUpgradeChargeRial: locked.toString(),
            ledgerEntryId: ledger.id,
            status: ResourceChangeStatus.WAITING_ADMIN_APPROVAL,
          },
          ip: input.ip,
          userAgent: input.userAgent,
          idempotencyKey: `audit:upgrade-pay:${request.id}`,
        },
        tx,
      );

      const refreshed = await tx.resourceChangeRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      return {
        reused: false as const,
        view: serializeUpgradeQuoteView({
          request: refreshed,
          walletBalanceRial: freshWallet.availableBalance,
        }),
        ledgerEntryId: ledger.id,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function upgradeQuoteHasFinancialCommitment(
  estimateSnapshot: unknown,
): boolean {
  const snap = parseUpgradeQuoteSnapshot(estimateSnapshot);
  return Boolean(snap?.financial?.walletDebitedAt && snap.financial.amountRial);
}
