import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import {
  HIGH_MARGIN_CONFIRMATION_PHRASE,
  computeCommercialPriceBreakdown,
  evaluateMarginGuardrail,
  grossMarginBpsToMarkupBps,
  markupBpsToGrossMarginBps,
  type CommercialPriceBreakdown,
} from "@/lib/pricing/commercial-engine";
import {
  resolveCatalogItemPricing,
} from "@/lib/pricing/plan-pricing";
import {
  resolveConfiguredPlanPricing,
  type PricingConfigs,
} from "@/lib/orders/plans";

const PROVIDERS = [
  InfrastructureProvider.ARVAN,
  InfrastructureProvider.PARSPACK,
] as const;

const COMPASS_SERVICE_CODES = [
  "SITE_MIGRATION",
  "INITIAL_SETUP",
  "DOMAIN_SSL",
  "BACKUP_RESTORE",
  "ARCHITECTURE_LIGHT",
] as const;

export type FinanceProviderInput = {
  provider: (typeof PROVIDERS)[number];
  /** Target gross margin in bps — the canonical Admin input. */
  targetGrossMarginBps: number;
  enabled: boolean;
};

export type FinanceProductMarkupInput = {
  provider: (typeof PROVIDERS)[number];
  productKind: InfrastructureProductKind;
  markupBasisPoints: number;
  enabled: boolean;
};

export type FinanceParchinInput = {
  level: ParchinLevel;
  title: string;
  description: string | null;
  priceRial: bigint;
  active: boolean;
};

export type FinanceConfigurationInput = {
  providers: FinanceProviderInput[];
  productMarkups: FinanceProductMarkupInput[];
  taxBps: number;
  reminderDaysBeforeDue: number;
  suspendGraceDaysAfterZero: number;
  deleteDaysAfterSuspend: number;
  compassServicePrices: Record<string, string>;
  parchin: FinanceParchinInput[];
  priceDisplay: {
    showHourlyPrice: boolean;
    showDailyPrice: boolean;
    showMonthlyPrice: boolean;
  };
  reason?: string | null;
  /** Required verbatim when any margin ≥ 70%. */
  highMarginConfirmation?: string | null;
};

export type FinanceConfigurationErrorCode =
  | "invalid_margin"
  | "margin_confirmation_required"
  | "card_quote_parity_failed"
  | "invalid_configuration"
  | "revision_not_found";

export class FinanceConfigurationError extends Error {
  readonly code: FinanceConfigurationErrorCode;

  constructor(code: FinanceConfigurationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function guardrailForProviders(providers: FinanceProviderInput[]) {
  let strongest: "ok" | "warn" | "confirm" = "ok";
  for (const item of providers) {
    const { level } = evaluateMarginGuardrail(item.targetGrossMarginBps);
    if (level === "confirm") strongest = "confirm";
    else if (level === "warn" && strongest === "ok") strongest = "warn";
  }
  return strongest;
}

export function financeConfigurationSnapshot(input: FinanceConfigurationInput) {
  return {
    providers: input.providers.map((item) => ({
      provider: item.provider,
      targetGrossMarginBps: item.targetGrossMarginBps,
      markupBasisPoints: grossMarginBpsToMarkupBps(item.targetGrossMarginBps),
      enabled: item.enabled,
    })),
    productMarkups: input.productMarkups.map((item) => ({
      provider: item.provider,
      productKind: item.productKind,
      markupBasisPoints: item.markupBasisPoints,
      enabled: item.enabled,
    })),
    taxBps: input.taxBps,
    reminderDaysBeforeDue: input.reminderDaysBeforeDue,
    suspendGraceDaysAfterZero: input.suspendGraceDaysAfterZero,
    deleteDaysAfterSuspend: input.deleteDaysAfterSuspend,
    compassServicePrices: input.compassServicePrices,
    parchin: input.parchin.map((item) => ({
      level: item.level,
      title: item.title,
      description: item.description,
      priceRial: item.priceRial.toString(),
      active: item.active,
    })),
    priceDisplay: input.priceDisplay,
  };
}

export function validateFinanceConfiguration(
  input: FinanceConfigurationInput,
  options: { skipHighMarginConfirmation?: boolean } = {},
) {
  if (input.providers.length === 0) {
    throw new FinanceConfigurationError(
      "invalid_configuration",
      "حداقل یک منبع لازم است.",
    );
  }
  for (const item of input.providers) {
    try {
      evaluateMarginGuardrail(item.targetGrossMarginBps);
    } catch {
      throw new FinanceConfigurationError(
        "invalid_margin",
        "حاشیه سود باید بین ۰ و کمتر از ۱۰۰٪ باشد.",
      );
    }
  }
  const guardrail = guardrailForProviders(input.providers);
  if (
    guardrail === "confirm" &&
    !options.skipHighMarginConfirmation &&
    input.highMarginConfirmation !== HIGH_MARGIN_CONFIRMATION_PHRASE
  ) {
    throw new FinanceConfigurationError(
      "margin_confirmation_required",
      `برای حاشیه ۷۰٪ یا بیشتر باید عبارت «${HIGH_MARGIN_CONFIRMATION_PHRASE}» را تایپ کنی.`,
    );
  }
  if (
    !Number.isInteger(input.taxBps) ||
    input.taxBps < 0 ||
    input.taxBps > 10_000
  ) {
    throw new FinanceConfigurationError(
      "invalid_configuration",
      "مالیات باید بین ۰ تا ۱۰۰٪ باشد.",
    );
  }
  for (const day of [
    input.reminderDaysBeforeDue,
    input.suspendGraceDaysAfterZero,
    input.deleteDaysAfterSuspend,
  ]) {
    if (!Number.isInteger(day) || day < 1 || day > 90) {
      throw new FinanceConfigurationError(
        "invalid_configuration",
        "روزهای چرخه باید بین ۱ تا ۹۰ باشند.",
      );
    }
  }
  for (const item of input.productMarkups) {
    if (
      !Number.isInteger(item.markupBasisPoints) ||
      item.markupBasisPoints < 0 ||
      item.markupBasisPoints > 100_000
    ) {
      throw new FinanceConfigurationError(
        "invalid_configuration",
        "Markup محصول معتبر نیست.",
      );
    }
  }
  if (
    !input.parchin.some(
      (item) => item.level === ParchinLevel.PARCHIN_START && item.active,
    )
  ) {
    throw new FinanceConfigurationError(
      "invalid_configuration",
      "پرچین شروع باید فعال بماند.",
    );
  }
  for (const item of input.parchin) {
    if (!item.title.trim() || item.priceRial < 0n) {
      throw new FinanceConfigurationError(
        "invalid_configuration",
        "پرچین معتبر نیست.",
      );
    }
  }
  for (const code of COMPASS_SERVICE_CODES) {
    const raw = input.compassServicePrices[code];
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
      throw new FinanceConfigurationError(
        "invalid_configuration",
        "قیمت خدمت قطب‌نما معتبر نیست.",
      );
    }
  }
  return { guardrail };
}

export async function readFinanceConfiguration() {
  const [providers, products, commerce, parchin, storefront, revisions] =
    await Promise.all([
      prisma.providerPricingConfig.findMany({
        where: { provider: { in: [...PROVIDERS] } },
      }),
      prisma.productPricingConfig.findMany({
        orderBy: [{ provider: "asc" }, { productKind: "asc" }],
      }),
      prisma.commercePricingConfig.findUnique({ where: { id: "default" } }),
      prisma.parchinPricingConfig.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.storefrontAssortmentSettings.findUnique({
        where: { id: "default" },
      }),
      prisma.financeConfigurationRevision.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          reason: true,
          rollbackOfId: true,
          actor: { select: { id: true, mobile: true } },
        },
      }),
    ]);
  const byProvider = new Map(providers.map((row) => [row.provider, row]));
  const servicePrices =
    commerce?.compassServicePrices &&
    typeof commerce.compassServicePrices === "object" &&
    !Array.isArray(commerce.compassServicePrices)
      ? (commerce.compassServicePrices as Record<string, string>)
      : {};
  return {
    providers: PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      const markupBasisPoints = row?.markupBasisPoints ?? 4_286;
      return {
        provider,
        markupBasisPoints,
        targetGrossMarginBps: markupBpsToGrossMarginBps(markupBasisPoints),
        enabled: row?.enabled ?? true,
      };
    }),
    productMarkups: products.map((row) => ({
      provider: row.provider,
      apiVersion: row.apiVersion,
      productKind: row.productKind,
      markupBasisPoints: row.markupBasisPoints,
      enabled: row.enabled,
    })),
    taxBps: commerce?.taxBps ?? 1000,
    reminderDaysBeforeDue: commerce?.reminderDaysBeforeDue ?? 7,
    suspendGraceDaysAfterZero: commerce?.suspendGraceDaysAfterZero ?? 7,
    deleteDaysAfterSuspend: commerce?.deleteDaysAfterSuspend ?? 7,
    compassServicePrices: {
      SITE_MIGRATION: servicePrices.SITE_MIGRATION ?? "15000000",
      INITIAL_SETUP: servicePrices.INITIAL_SETUP ?? "8000000",
      DOMAIN_SSL: servicePrices.DOMAIN_SSL ?? "3000000",
      BACKUP_RESTORE: servicePrices.BACKUP_RESTORE ?? "5000000",
      ARCHITECTURE_LIGHT: servicePrices.ARCHITECTURE_LIGHT ?? "10000000",
    },
    parchin: parchin.map((row) => ({
      level: row.level,
      title: row.title,
      description: row.description,
      priceRial: row.priceRial.toString(),
      active: row.active,
    })),
    priceDisplay: {
      showHourlyPrice: storefront?.showHourlyPrice ?? true,
      showDailyPrice: storefront?.showDailyPrice ?? true,
      showMonthlyPrice: storefront?.showMonthlyPrice ?? true,
    },
    revisions: revisions.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      reason: row.reason,
      rollbackOfId: row.rollbackOfId,
      actorMobile: row.actor?.mobile ?? null,
    })),
  };
}

/**
 * Atomic publish: every pricing surface is written in ONE transaction and an
 * append-only revision records who changed what and why. Historical orders
 * keep their own snapshots — revisions only affect future sales.
 */
export async function applyFinanceConfiguration(params: {
  input: FinanceConfigurationInput;
  actorUserId: string | null;
  rollbackOfId?: string | null;
  meta?: { ip?: string | null; userAgent?: string | null };
}) {
  const { input, actorUserId } = params;
  validateFinanceConfiguration(input, {
    skipHighMarginConfirmation: Boolean(params.rollbackOfId),
  });
  const parity = await checkCardQuoteParity(input);
  if (!parity.ok) {
    throw new FinanceConfigurationError(
      "card_quote_parity_failed",
      "قیمت Card و Quote برای یک ماه برابر نشد؛ انتشار متوقف شد.",
    );
  }
  const snapshot = financeConfigurationSnapshot(input);

  return prisma.$transaction(async (tx) => {
    for (const item of input.providers) {
      const markupBasisPoints = grossMarginBpsToMarkupBps(
        item.targetGrossMarginBps,
      );
      await tx.providerPricingConfig.upsert({
        where: { provider: item.provider },
        update: {
          markupBasisPoints,
          enabled: item.enabled,
          updatedById: actorUserId,
        },
        create: {
          id: `${item.provider.toLowerCase()}-v1`,
          provider: item.provider,
          apiVersion: "v1",
          sourceMoneyUnit:
            item.provider === InfrastructureProvider.ARVAN ? "IRR" : null,
          markupBasisPoints,
          enabled: item.enabled,
          updatedById: actorUserId,
        },
      });
    }
    for (const item of input.productMarkups) {
      await tx.productPricingConfig.upsert({
        where: {
          provider_apiVersion_productKind: {
            provider: item.provider,
            apiVersion: "v1",
            productKind: item.productKind,
          },
        },
        update: {
          markupBasisPoints: item.markupBasisPoints,
          enabled: item.enabled,
          updatedById: actorUserId,
        },
        create: {
          provider: item.provider,
          apiVersion: "v1",
          productKind: item.productKind,
          markupBasisPoints: item.markupBasisPoints,
          enabled: item.enabled,
          updatedById: actorUserId,
        },
      });
    }
    await tx.commercePricingConfig.upsert({
      where: { id: "default" },
      update: {
        taxBps: input.taxBps,
        reminderDaysBeforeDue: input.reminderDaysBeforeDue,
        suspendGraceDaysAfterZero: input.suspendGraceDaysAfterZero,
        deleteDaysAfterSuspend: input.deleteDaysAfterSuspend,
        compassServicePrices: input.compassServicePrices,
        updatedById: actorUserId,
      },
      create: {
        id: "default",
        taxBps: input.taxBps,
        reminderDaysBeforeDue: input.reminderDaysBeforeDue,
        suspendGraceDaysAfterZero: input.suspendGraceDaysAfterZero,
        deleteDaysAfterSuspend: input.deleteDaysAfterSuspend,
        compassServicePrices: input.compassServicePrices,
        updatedById: actorUserId,
      },
    });
    for (const item of input.parchin) {
      await tx.parchinPricingConfig.update({
        where: { level: item.level },
        data: {
          title: item.title,
          description: item.description,
          priceRial: item.priceRial,
          active: item.active,
          updatedById: actorUserId,
        },
      });
    }
    await tx.storefrontAssortmentSettings.upsert({
      where: { id: "default" },
      update: {
        showHourlyPrice: input.priceDisplay.showHourlyPrice,
        showDailyPrice: input.priceDisplay.showDailyPrice,
        showMonthlyPrice: input.priceDisplay.showMonthlyPrice,
        updatedById: actorUserId,
      },
      create: {
        id: "default",
        showHourlyPrice: input.priceDisplay.showHourlyPrice,
        showDailyPrice: input.priceDisplay.showDailyPrice,
        showMonthlyPrice: input.priceDisplay.showMonthlyPrice,
        updatedById: actorUserId,
      },
    });
    const revision = await tx.financeConfigurationRevision.create({
      data: {
        actorUserId,
        reason: input.reason?.trim() || null,
        rollbackOfId: params.rollbackOfId ?? null,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
    });
    if (actorUserId) {
      await writeAuditLog(
        {
          actorUserId,
          action: AuditActions.PLAN_UPDATE,
          entityType: "finance_configuration_revision",
          entityId: revision.id,
          afterData: snapshot,
          ip: params.meta?.ip ?? undefined,
          userAgent: params.meta?.userAgent ?? undefined,
        },
        tx,
      );
    }
    return revision;
  });
}

export async function rollbackFinanceConfiguration(params: {
  revisionId: string;
  actorUserId: string | null;
  reason?: string | null;
  meta?: { ip?: string | null; userAgent?: string | null };
}) {
  const revision = await prisma.financeConfigurationRevision.findUnique({
    where: { id: params.revisionId },
  });
  if (!revision) {
    throw new FinanceConfigurationError(
      "revision_not_found",
      "نسخه تنظیمات پیدا نشد.",
    );
  }
  const input = financeInputFromSnapshot(revision.snapshot);
  input.reason =
    params.reason?.trim() ||
    `بازگشت به نسخه ${revision.createdAt.toISOString()}`;
  return applyFinanceConfiguration({
    input,
    actorUserId: params.actorUserId,
    rollbackOfId: revision.id,
    meta: params.meta,
  });
}

function financeInputFromSnapshot(snapshot: unknown): FinanceConfigurationInput {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new FinanceConfigurationError(
      "invalid_configuration",
      "Snapshot نسخه معتبر نیست.",
    );
  }
  const value = snapshot as Record<string, unknown>;
  const providers = Array.isArray(value.providers) ? value.providers : [];
  const productMarkups = Array.isArray(value.productMarkups)
    ? value.productMarkups
    : [];
  const parchin = Array.isArray(value.parchin) ? value.parchin : [];
  const priceDisplay =
    value.priceDisplay && typeof value.priceDisplay === "object"
      ? (value.priceDisplay as Record<string, unknown>)
      : {};
  return {
    providers: providers.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        provider: item.provider as (typeof PROVIDERS)[number],
        targetGrossMarginBps: Number(item.targetGrossMarginBps),
        enabled: item.enabled === true,
      };
    }),
    productMarkups: productMarkups.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        provider: item.provider as (typeof PROVIDERS)[number],
        productKind: item.productKind as InfrastructureProductKind,
        markupBasisPoints: Number(item.markupBasisPoints),
        enabled: item.enabled === true,
      };
    }),
    taxBps: Number(value.taxBps),
    reminderDaysBeforeDue: Number(value.reminderDaysBeforeDue),
    suspendGraceDaysAfterZero: Number(value.suspendGraceDaysAfterZero),
    deleteDaysAfterSuspend: Number(value.deleteDaysAfterSuspend),
    compassServicePrices:
      value.compassServicePrices &&
      typeof value.compassServicePrices === "object" &&
      !Array.isArray(value.compassServicePrices)
        ? (value.compassServicePrices as Record<string, string>)
        : {},
    parchin: parchin.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        level: item.level as ParchinLevel,
        title: String(item.title ?? ""),
        description:
          typeof item.description === "string" ? item.description : null,
        priceRial: BigInt(String(item.priceRial ?? "0")),
        active: item.active === true,
      };
    }),
    priceDisplay: {
      showHourlyPrice: priceDisplay.showHourlyPrice !== false,
      showDailyPrice: priceDisplay.showDailyPrice !== false,
      showMonthlyPrice: priceDisplay.showMonthlyPrice !== false,
    },
  };
}

type CandidatePricingContext = {
  providerMarkupBps: Map<string, { markupBps: number; enabled: boolean }>;
  productMarkupBps: Map<string, { markupBps: number; enabled: boolean }>;
  parchinPriceByLevel: Map<ParchinLevel, bigint>;
  parchinActiveByLevel: Map<ParchinLevel, boolean>;
  taxBps: number;
};

function candidateContext(input: FinanceConfigurationInput): CandidatePricingContext {
  return {
    providerMarkupBps: new Map(
      input.providers.map((item) => [
        item.provider,
        {
          markupBps: grossMarginBpsToMarkupBps(item.targetGrossMarginBps),
          enabled: item.enabled,
        },
      ]),
    ),
    productMarkupBps: new Map(
      input.productMarkups.map((item) => [
        `${item.provider}:${item.productKind}`,
        { markupBps: item.markupBasisPoints, enabled: item.enabled },
      ]),
    ),
    parchinPriceByLevel: new Map(
      input.parchin.map((item) => [item.level, item.priceRial]),
    ),
    parchinActiveByLevel: new Map(
      input.parchin.map((item) => [item.level, item.active]),
    ),
    taxBps: input.taxBps,
  };
}

async function samplePlansForImpact(limit = 24) {
  return prisma.infrastructurePlan.findMany({
    where: {
      offerSource: "API_CATALOG",
      active: true,
      publicationStatus: "PUBLISHED",
      catalogMappingStatus: "MAPPED",
      deliveryMode: "MANAGED",
      catalogItem: { isNot: null },
    },
    include: { catalogItem: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

function priceWithContext(
  plan: Awaited<ReturnType<typeof samplePlansForImpact>>[number],
  context: CandidatePricingContext,
): { finalPriceRial: bigint; sellable: boolean } | null {
  if (!plan.catalogItem) return null;
  const provider = context.providerMarkupBps.get(plan.provider);
  const product = context.productMarkupBps.get(
    `${plan.provider}:${plan.productKind}`,
  );
  const parchinLevel =
    plan.minimumParchinLevel ??
    (plan.parchinIncluded ? ("PARCHIN_START" as ParchinLevel) : null);
  if (!provider || !parchinLevel) return null;
  const parchinActive = context.parchinActiveByLevel.get(parchinLevel) ?? false;
  const sellable =
    provider.enabled && (product?.enabled ?? false) && parchinActive;
  const priced = resolveCatalogItemPricing(
    plan.catalogItem,
    { markupBasisPoints: provider.markupBps },
    {
      productMarkupBasisPoints:
        plan.skuMarkupBasisPoints ?? product?.markupBps ?? 0,
      taxBasisPoints: context.taxBps,
      parchinLevel,
      parchinPriceRial: context.parchinPriceByLevel.get(parchinLevel) ?? 0n,
      termMonths: 1,
    },
  );
  if (!priced) return null;
  return { finalPriceRial: priced.finalPriceRial, sellable };
}

function candidateAsPricingConfigs(
  input: FinanceConfigurationInput,
): PricingConfigs {
  const now = new Date();
  return {
    providers: input.providers.map((item) => ({
      id: `${item.provider.toLowerCase()}-v1`,
      provider: item.provider,
      apiVersion: "v1",
      enabled: item.enabled,
      sourceMoneyUnit: null,
      markupBasisPoints: grossMarginBpsToMarkupBps(item.targetGrossMarginBps),
      updatedAt: now,
      updatedById: null,
    })),
    products: input.productMarkups
      .filter((item) => item.enabled)
      .map((item) => ({
        id: `${item.provider}:${item.productKind}`,
        provider: item.provider,
        apiVersion: "v1",
        productKind: item.productKind,
        markupBasisPoints: item.markupBasisPoints,
        enabled: item.enabled,
        updatedById: null,
        createdAt: now,
        updatedAt: now,
      })),
    commerce: {
      id: "default",
      taxBps: input.taxBps,
      reminderDaysBeforeDue: input.reminderDaysBeforeDue,
      suspendGraceDaysAfterZero: input.suspendGraceDaysAfterZero,
      deleteDaysAfterSuspend: input.deleteDaysAfterSuspend,
      compassServicePrices: input.compassServicePrices,
      updatedById: null,
      updatedAt: now,
    },
    parchin: input.parchin
      .filter((item) => item.active)
      .map((item, index) => ({
        id: `parchin:${item.level}`,
        level: item.level,
        title: item.title,
        description: item.description,
        priceRial: item.priceRial,
        active: item.active,
        sortOrder: index,
        updatedById: null,
        createdAt: now,
        updatedAt: now,
      })),
  } as PricingConfigs;
}

/**
 * Card vs Quote 1-month parity. The card side mirrors the storefront option
 * set; the quote side runs the REAL checkout pricing resolver. Any mismatch
 * means the two surfaces drifted, and publishing is blocked while it fails.
 */
export async function checkCardQuoteParity(input: FinanceConfigurationInput) {
  const cardContext = candidateContext(input);
  const quoteConfigs = candidateAsPricingConfigs(input);
  const plans = await samplePlansForImpact(10);
  const mismatches: Array<{ planId: string; card: string; quote: string }> = [];
  for (const plan of plans) {
    const card = priceWithContext(plan, cardContext);
    const quote = resolveConfiguredPlanPricing(plan, quoteConfigs, undefined, {
      termMonths: 1,
    });
    if (!card?.sellable && !quote) continue;
    if (!card || !quote) {
      mismatches.push({
        planId: plan.id,
        card: card?.finalPriceRial.toString() ?? "unavailable",
        quote: quote?.finalPriceRial.toString() ?? "unavailable",
      });
      continue;
    }
    if (card.finalPriceRial !== quote.finalPriceRial) {
      mismatches.push({
        planId: plan.id,
        card: card.finalPriceRial.toString(),
        quote: quote.finalPriceRial.toString(),
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches, sampled: plans.length };
}

export type FinanceImpactRow = {
  planId: string;
  title: string;
  provider: string;
  currentFinalRial: string | null;
  candidateFinalRial: string | null;
  deltaRial: string | null;
  deltaBps: number | null;
  sellable: boolean;
};

/**
 * Preview the effect of a candidate configuration on real published plans
 * before publishing: affected counts plus the largest increases/decreases.
 */
export async function previewFinanceImpact(input: FinanceConfigurationInput) {
  const current = await readFinanceConfiguration();
  const currentInput: FinanceConfigurationInput = {
    providers: current.providers.map((item) => ({
      provider: item.provider,
      targetGrossMarginBps: item.targetGrossMarginBps,
      enabled: item.enabled,
    })),
    productMarkups: current.productMarkups
      .filter((item) =>
        PROVIDERS.includes(item.provider as (typeof PROVIDERS)[number]),
      )
      .map((item) => ({
        provider: item.provider as (typeof PROVIDERS)[number],
        productKind: item.productKind,
        markupBasisPoints: item.markupBasisPoints,
        enabled: item.enabled,
      })),
    taxBps: current.taxBps,
    reminderDaysBeforeDue: current.reminderDaysBeforeDue,
    suspendGraceDaysAfterZero: current.suspendGraceDaysAfterZero,
    deleteDaysAfterSuspend: current.deleteDaysAfterSuspend,
    compassServicePrices: current.compassServicePrices,
    parchin: current.parchin.map((item) => ({
      level: item.level,
      title: item.title,
      description: item.description,
      priceRial: BigInt(item.priceRial),
      active: item.active,
    })),
    priceDisplay: current.priceDisplay,
  };
  const candidateCtx = candidateContext(input);
  const currentCtx = candidateContext(currentInput);
  const plans = await samplePlansForImpact(24);

  const rows: FinanceImpactRow[] = [];
  let increased = 0;
  let decreased = 0;
  let unchanged = 0;
  for (const plan of plans) {
    const currentPrice = priceWithContext(plan, currentCtx);
    const candidatePrice = priceWithContext(plan, candidateCtx);
    const currentFinal = currentPrice?.finalPriceRial ?? null;
    const candidateFinal = candidatePrice?.finalPriceRial ?? null;
    let deltaRial: bigint | null = null;
    let deltaBps: number | null = null;
    if (currentFinal != null && candidateFinal != null) {
      deltaRial = candidateFinal - currentFinal;
      deltaBps =
        currentFinal > 0n
          ? Number((deltaRial * 10_000n) / currentFinal)
          : null;
      if (deltaRial > 0n) increased += 1;
      else if (deltaRial < 0n) decreased += 1;
      else unchanged += 1;
    }
    rows.push({
      planId: plan.id,
      title: plan.title,
      provider: plan.provider,
      currentFinalRial: currentFinal?.toString() ?? null,
      candidateFinalRial: candidateFinal?.toString() ?? null,
      deltaRial: deltaRial?.toString() ?? null,
      deltaBps,
      sellable: candidatePrice?.sellable ?? false,
    });
  }
  const withDelta = rows.filter((row) => row.deltaRial != null);
  const sortedByDelta = [...withDelta].sort((a, b) => {
    const deltaA = BigInt(a.deltaRial ?? "0");
    const deltaB = BigInt(b.deltaRial ?? "0");
    return deltaA === deltaB ? 0 : deltaA > deltaB ? -1 : 1;
  });
  return {
    sampledPlans: rows.length,
    affectedPlans: increased + decreased,
    increasedPlans: increased,
    decreasedPlans: decreased,
    unchangedPlans: unchanged,
    notSellablePlans: rows.filter((row) => !row.sellable).length,
    topIncreases: sortedByDelta
      .filter((row) => BigInt(row.deltaRial ?? "0") > 0n)
      .slice(0, 5),
    topDecreases: sortedByDelta
      .filter((row) => BigInt(row.deltaRial ?? "0") < 0n)
      .reverse()
      .slice(0, 5),
    rows,
  };
}

export type FinanceSimulatorRequest = {
  providerMonthlyCostRial: bigint;
  provider: (typeof PROVIDERS)[number];
  productKind: InfrastructureProductKind;
  termMonths: 1 | 3 | 6 | 12;
  parchinLevel: ParchinLevel;
  couponDiscountBps?: number | null;
};

/** Run the REAL production engine for the Admin simulator. */
export function simulateFinanceBreakdown(
  input: FinanceConfigurationInput,
  request: FinanceSimulatorRequest,
): {
  breakdown: CommercialPriceBreakdown;
  providerEnabled: boolean;
  productEnabled: boolean;
} {
  const context = candidateContext(input);
  const provider = context.providerMarkupBps.get(request.provider);
  const product = context.productMarkupBps.get(
    `${request.provider}:${request.productKind}`,
  );
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: request.providerMonthlyCostRial,
    providerMarkupBps: provider?.markupBps ?? 0,
    productMarkupBps: product?.markupBps ?? 0,
    parchinLevel: request.parchinLevel,
    parchinPriceIrr:
      context.parchinPriceByLevel.get(request.parchinLevel) ?? 0n,
    taxBps: context.taxBps,
    termMonths: request.termMonths,
    couponDiscountBps: request.couponDiscountBps ?? null,
  });
  return {
    breakdown,
    providerEnabled: provider?.enabled ?? false,
    productEnabled: product?.enabled ?? false,
  };
}
