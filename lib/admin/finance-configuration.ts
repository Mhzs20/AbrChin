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
import {
  DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS,
  defaultProfitCurveConfig,
  deriveProfitCurveTransitions,
  parseProfitCurveConfig,
  resolveProfitCurve,
  serializeProfitCurveConfig,
  validateProfitCurveMonotonicity,
  validateProfitCurveStructure,
  type ProfitCurveConfigInput,
} from "@/lib/pricing/profit-curve";
import {
  resolveProviderMarkupForPlan,
} from "@/lib/pricing/profit-curve-apply";
import { catalogItemBasePriceRial } from "@/lib/pricing/plan-pricing";
import { filterDominatedPlans } from "@/lib/storefront/dominance";

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
  subtitle?: string | null;
  description: string | null;
  priceRial: bigint;
  active: boolean;
  includedServices?: string[];
  excludedServices?: string[];
  supportWindow?: string | null;
  firstResponseTarget?: string | null;
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
  profitCurve?: ProfitCurveConfigInput;
  reason?: string | null;
  /** Required verbatim when any margin ≥ 70%. */
  highMarginConfirmation?: string | null;
};

export type FinanceConfigurationErrorCode =
  | "invalid_margin"
  | "margin_confirmation_required"
  | "card_quote_parity_failed"
  | "invalid_configuration"
  | "invalid_profit_curve"
  | "profit_curve_not_monotonic"
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

function resolveProfitCurveOrDefault(
  input: FinanceConfigurationInput,
): ProfitCurveConfigInput {
  return input.profitCurve ?? defaultProfitCurveConfig();
}

function guardrailForProvidersAndCurve(input: FinanceConfigurationInput) {
  let strongest: "ok" | "warn" | "confirm" = guardrailForProviders(
    input.providers,
  );
  const curve = resolveProfitCurveOrDefault(input);
  for (const band of curve.bands) {
    const { level } = evaluateMarginGuardrail(band.targetGrossMarginBps);
    if (level === "confirm") strongest = "confirm";
    else if (level === "warn" && strongest === "ok") strongest = "warn";
  }
  return strongest;
}

export function financeConfigurationSnapshot(input: FinanceConfigurationInput) {
  const profitCurve = resolveProfitCurveOrDefault(input);
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
      subtitle: item.subtitle ?? null,
      description: item.description,
      priceRial: item.priceRial.toString(),
      active: item.active,
      // Snapshot must always hold concrete service lists so rollback restores
      // a valid contract. Callers must merge omitted fields before snapshotting.
      includedServices: item.includedServices ?? [],
      excludedServices: item.excludedServices ?? [],
      supportWindow: item.supportWindow ?? null,
      firstResponseTarget: item.firstResponseTarget ?? null,
    })),
    priceDisplay: input.priceDisplay,
    profitCurve: serializeProfitCurveConfig(profitCurve),
    minimumPostDiscountGrossMarginBps:
      profitCurve.minimumPostDiscountGrossMarginBps,
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Finance Center price/title publishes often omit service-list fields.
 * Merge live contract fields so snapshots stay complete and rollback cannot
 * wipe included/excluded services.
 */
export function mergeParchinInputWithExisting(
  incoming: FinanceParchinInput,
  existing: {
    title: string;
    subtitle: string | null;
    description: string | null;
    priceRial: bigint;
    active: boolean;
    includedServices: unknown;
    excludedServices: unknown;
    supportWindow: string | null;
    firstResponseTarget: string | null;
  } | null,
): FinanceParchinInput {
  const existingIncluded = asStringList(existing?.includedServices);
  const existingExcluded = asStringList(existing?.excludedServices);
  const included =
    incoming.includedServices !== undefined
      ? incoming.includedServices
      : existingIncluded;
  const excluded =
    incoming.excludedServices !== undefined
      ? incoming.excludedServices
      : existingExcluded;
  return {
    level: incoming.level,
    title: incoming.title,
    subtitle:
      incoming.subtitle !== undefined
        ? incoming.subtitle
        : (existing?.subtitle ?? null),
    description: incoming.description,
    priceRial: incoming.priceRial,
    active: incoming.active,
    includedServices: included,
    excludedServices: excluded,
    supportWindow:
      incoming.supportWindow !== undefined
        ? incoming.supportWindow
        : (existing?.supportWindow ?? null),
    firstResponseTarget:
      incoming.firstResponseTarget !== undefined
        ? incoming.firstResponseTarget
        : (existing?.firstResponseTarget ?? null),
  };
}

export function parchinContractMateriallyChanged(
  existing: {
    title: string;
    subtitle: string | null;
    description: string | null;
    priceRial: bigint;
    active: boolean;
    includedServices: unknown;
    excludedServices: unknown;
    supportWindow: string | null;
    firstResponseTarget: string | null;
  },
  next: FinanceParchinInput,
): boolean {
  return (
    existing.title !== next.title ||
    (existing.subtitle ?? null) !== (next.subtitle ?? null) ||
    (existing.description ?? null) !== (next.description ?? null) ||
    existing.priceRial !== next.priceRial ||
    existing.active !== next.active ||
    JSON.stringify(asStringList(existing.includedServices)) !==
      JSON.stringify(next.includedServices ?? []) ||
    JSON.stringify(asStringList(existing.excludedServices)) !==
      JSON.stringify(next.excludedServices ?? []) ||
    (existing.supportWindow ?? null) !== (next.supportWindow ?? null) ||
    (existing.firstResponseTarget ?? null) !==
      (next.firstResponseTarget ?? null)
  );
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
  const profitCurve = input.profitCurve
    ? resolveProfitCurveOrDefault(input)
    : null;
  if (profitCurve) {
    const curveIssues = validateProfitCurveStructure(profitCurve);
    if (curveIssues.length > 0) {
      throw new FinanceConfigurationError(
        "invalid_profit_curve",
        curveIssues.map((issue) => issue.message).join(" "),
      );
    }
  }
  let guardrail = guardrailForProviders(input.providers);
  if (profitCurve) {
    const curveGuard = guardrailForProvidersAndCurve({
      ...input,
      profitCurve,
    });
    if (curveGuard === "confirm") guardrail = "confirm";
    else if (curveGuard === "warn" && guardrail === "ok") guardrail = "warn";
  }
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
  return { guardrail, profitCurve };
}

export async function readFinanceConfiguration() {
  const [
    providers,
    products,
    commerce,
    parchin,
    storefront,
    revisions,
    profitCurveRow,
  ] = await Promise.all([
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
      prisma.profitCurveConfiguration.findUnique({
        where: { id: "default" },
        include: { bands: { orderBy: { sortOrder: "asc" } } },
      }),
    ]);
  const byProvider = new Map(providers.map((row) => [row.provider, row]));
  const servicePrices =
    commerce?.compassServicePrices &&
    typeof commerce.compassServicePrices === "object" &&
    !Array.isArray(commerce.compassServicePrices)
      ? (commerce.compassServicePrices as Record<string, string>)
      : {};
  const profitCurve: ProfitCurveConfigInput = profitCurveRow
    ? {
        enabled: profitCurveRow.enabled,
        minimumPostDiscountGrossMarginBps:
          profitCurveRow.minimumPostDiscountGrossMarginBps,
        bands: profitCurveRow.bands.map((band) => ({
          id: band.id,
          sortOrder: band.sortOrder,
          minProviderCostRial: band.minProviderCostRial,
          maxProviderCostRial: band.maxProviderCostRial,
          targetGrossMarginBps: band.targetGrossMarginBps,
        })),
      }
    : defaultProfitCurveConfig();
  const transitions = deriveProfitCurveTransitions(profitCurve.bands);
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
    minimumPostDiscountGrossMarginBps:
      commerce?.minimumPostDiscountGrossMarginBps ??
      profitCurve.minimumPostDiscountGrossMarginBps ??
      DEFAULT_MINIMUM_POST_DISCOUNT_GROSS_MARGIN_BPS,
    compassServicePrices: {
      SITE_MIGRATION: servicePrices.SITE_MIGRATION ?? "15000000",
      INITIAL_SETUP: servicePrices.INITIAL_SETUP ?? "8000000",
      DOMAIN_SSL: servicePrices.DOMAIN_SSL ?? "3000000",
      BACKUP_RESTORE: servicePrices.BACKUP_RESTORE ?? "5000000",
      ARCHITECTURE_LIGHT: servicePrices.ARCHITECTURE_LIGHT ?? "10000000",
    },
    parchin: parchin.map((row) => ({
      level: row.level,
      version: row.version,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      priceRial: row.priceRial.toString(),
      active: row.active,
      includedServices: Array.isArray(row.includedServices)
        ? row.includedServices
        : [],
      excludedServices: Array.isArray(row.excludedServices)
        ? row.excludedServices
        : [],
      supportWindow: row.supportWindow,
      firstResponseTarget: row.firstResponseTarget,
      effectiveFrom: row.effectiveFrom.toISOString(),
    })),
    priceDisplay: {
      showHourlyPrice: storefront?.showHourlyPrice ?? true,
      showDailyPrice: storefront?.showDailyPrice ?? true,
      showMonthlyPrice: storefront?.showMonthlyPrice ?? true,
    },
    profitCurve: {
      ...serializeProfitCurveConfig(profitCurve),
      activeRevisionId: profitCurveRow?.activeRevisionId ?? null,
      updatedAt: profitCurveRow?.updatedAt?.toISOString() ?? null,
      transitions: transitions.map((t) => ({
        bandIndex: t.bandIndex,
        boundaryRial: t.boundaryRial.toString(),
        previousMarginBps: t.previousMarginBps,
        nextMarginBps: t.nextMarginBps,
        boundarySaleRial: t.boundarySaleRial.toString(),
        transitionEndRial: t.transitionEndRial.toString(),
      })),
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
  idempotencyKey?: string | null;
  meta?: { ip?: string | null; userAgent?: string | null };
}) {
  const { input, actorUserId } = params;
  const validated = validateFinanceConfiguration(input, {
    skipHighMarginConfirmation: Boolean(params.rollbackOfId),
  });
  const profitCurve =
    validated.profitCurve ??
    (await loadCurrentProfitCurveConfig()) ??
    defaultProfitCurveConfig();
  // Always structure-validate the effective curve before publish.
  const structureIssues = validateProfitCurveStructure(profitCurve);
  if (structureIssues.length > 0) {
    throw new FinanceConfigurationError(
      "invalid_profit_curve",
      structureIssues.map((issue) => issue.message).join(" "),
    );
  }
  const mergedForPublish: FinanceConfigurationInput = {
    ...input,
    profitCurve,
  };

  const catalogCosts = await loadSellableCatalogCostsRial();
  const mono = validateProfitCurveMonotonicity(profitCurve.bands, {
    catalogCostsRial: catalogCosts,
    syntheticPoints: 2_000,
  });
  if (!mono.ok) {
    throw new FinanceConfigurationError(
      "profit_curve_not_monotonic",
      mono.issues.map((issue) => issue.message).join(" "),
    );
  }

  const parity = await checkCardQuoteParity(mergedForPublish);
  if (!parity.ok) {
    throw new FinanceConfigurationError(
      "card_quote_parity_failed",
      "قیمت Card و Quote برای یک ماه برابر نشد؛ انتشار متوقف شد.",
    );
  }

  const existingParchinRows = await prisma.parchinPricingConfig.findMany({
    where: { level: { in: input.parchin.map((item) => item.level) } },
  });
  const existingByLevel = new Map(
    existingParchinRows.map((row) => [row.level, row]),
  );
  const mergedParchin = input.parchin.map((item) =>
    mergeParchinInputWithExisting(item, existingByLevel.get(item.level) ?? null),
  );
  const mergedInput: FinanceConfigurationInput = {
    ...mergedForPublish,
    parchin: mergedParchin,
  };
  const snapshot = financeConfigurationSnapshot(mergedInput);
  const auditIdempotencyKey = params.idempotencyKey
    ? `finance-config:${params.idempotencyKey}`
    : null;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended('finance-configuration-publish', 0)
      )::text AS locked
    `;

    if (auditIdempotencyKey && actorUserId) {
      const prior = await tx.auditLog.findUnique({
        where: { idempotencyKey: auditIdempotencyKey },
      });
      if (prior?.entityId) {
        const priorRevision = await tx.financeConfigurationRevision.findUnique({
          where: { id: prior.entityId },
        });
        if (priorRevision) return priorRevision;
      }
    }

    for (const item of mergedInput.providers) {
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
    for (const item of mergedInput.productMarkups) {
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
        taxBps: mergedInput.taxBps,
        reminderDaysBeforeDue: mergedInput.reminderDaysBeforeDue,
        suspendGraceDaysAfterZero: mergedInput.suspendGraceDaysAfterZero,
        deleteDaysAfterSuspend: mergedInput.deleteDaysAfterSuspend,
        minimumPostDiscountGrossMarginBps:
          profitCurve.minimumPostDiscountGrossMarginBps,
        compassServicePrices: mergedInput.compassServicePrices,
        updatedById: actorUserId,
      },
      create: {
        id: "default",
        taxBps: mergedInput.taxBps,
        reminderDaysBeforeDue: mergedInput.reminderDaysBeforeDue,
        suspendGraceDaysAfterZero: mergedInput.suspendGraceDaysAfterZero,
        deleteDaysAfterSuspend: mergedInput.deleteDaysAfterSuspend,
        minimumPostDiscountGrossMarginBps:
          profitCurve.minimumPostDiscountGrossMarginBps,
        compassServicePrices: mergedInput.compassServicePrices,
        updatedById: actorUserId,
      },
    });
    for (const item of mergedInput.parchin) {
      const existing = await tx.parchinPricingConfig.findUnique({
        where: { level: item.level },
      });
      if (!existing) {
        throw new FinanceConfigurationError(
          "invalid_configuration",
          `سطح پرچین ${item.level} پیدا نشد.`,
        );
      }
      const changed = parchinContractMateriallyChanged(existing, item);
      const nextVersion = changed
        ? (existing.version ?? 1) + 1
        : (existing.version ?? 1);
      await tx.parchinPricingConfig.update({
        where: { level: item.level },
        data: {
          title: item.title,
          subtitle: item.subtitle ?? existing.subtitle ?? null,
          description: item.description,
          priceRial: item.priceRial,
          active: item.active,
          includedServices: item.includedServices ?? [],
          excludedServices: item.excludedServices ?? [],
          supportWindow: item.supportWindow ?? existing.supportWindow ?? null,
          firstResponseTarget:
            item.firstResponseTarget ?? existing.firstResponseTarget ?? null,
          version: nextVersion,
          ...(changed ? { effectiveFrom: new Date() } : {}),
          updatedById: actorUserId,
        },
      });
    }
    await tx.storefrontAssortmentSettings.upsert({
      where: { id: "default" },
      update: {
        showHourlyPrice: mergedInput.priceDisplay.showHourlyPrice,
        showDailyPrice: mergedInput.priceDisplay.showDailyPrice,
        showMonthlyPrice: mergedInput.priceDisplay.showMonthlyPrice,
        updatedById: actorUserId,
      },
      create: {
        id: "default",
        showHourlyPrice: mergedInput.priceDisplay.showHourlyPrice,
        showDailyPrice: mergedInput.priceDisplay.showDailyPrice,
        showMonthlyPrice: mergedInput.priceDisplay.showMonthlyPrice,
        updatedById: actorUserId,
      },
    });

    await tx.profitCurveConfiguration.upsert({
      where: { id: "default" },
      update: {
        enabled: profitCurve.enabled,
        minimumPostDiscountGrossMarginBps:
          profitCurve.minimumPostDiscountGrossMarginBps,
        updatedById: actorUserId,
      },
      create: {
        id: "default",
        enabled: profitCurve.enabled,
        minimumPostDiscountGrossMarginBps:
          profitCurve.minimumPostDiscountGrossMarginBps,
        updatedById: actorUserId,
      },
    });
    await tx.profitCurveBand.deleteMany({
      where: { configurationId: "default" },
    });
    for (const band of [...profitCurve.bands].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )) {
      await tx.profitCurveBand.create({
        data: {
          id: band.id && band.id.length > 0 ? band.id : undefined,
          configurationId: "default",
          sortOrder: band.sortOrder,
          minProviderCostRial: band.minProviderCostRial,
          maxProviderCostRial: band.maxProviderCostRial,
          targetGrossMarginBps: band.targetGrossMarginBps,
        },
      });
    }

    const revision = await tx.financeConfigurationRevision.create({
      data: {
        actorUserId,
        reason: mergedInput.reason?.trim() || null,
        rollbackOfId: params.rollbackOfId ?? null,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
    });
    await tx.profitCurveConfiguration.update({
      where: { id: "default" },
      data: { activeRevisionId: revision.id },
    });
    if (actorUserId) {
      await writeAuditLog(
        {
          actorUserId,
          action: AuditActions.PLAN_UPDATE,
          entityType: "finance_configuration_revision",
          entityId: revision.id,
          afterData: snapshot,
          idempotencyKey: auditIdempotencyKey,
          ip: params.meta?.ip ?? undefined,
          userAgent: params.meta?.userAgent ?? undefined,
        },
        tx,
      );
    }
    return revision;
  });
}

async function loadCurrentProfitCurveConfig(): Promise<ProfitCurveConfigInput | null> {
  const row = await prisma.profitCurveConfiguration.findUnique({
    where: { id: "default" },
    include: { bands: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row || row.bands.length === 0) return null;
  return {
    enabled: row.enabled,
    minimumPostDiscountGrossMarginBps: row.minimumPostDiscountGrossMarginBps,
    bands: row.bands.map((band) => ({
      id: band.id,
      sortOrder: band.sortOrder,
      minProviderCostRial: band.minProviderCostRial,
      maxProviderCostRial: band.maxProviderCostRial,
      targetGrossMarginBps: band.targetGrossMarginBps,
    })),
  };
}

async function loadSellableCatalogCostsRial(): Promise<bigint[]> {
  const items = await prisma.providerCatalogItem.findMany({
    where: {
      active: true,
      available: true,
      status: "ACTIVE",
      providerMonthlyPriceIrr: { gt: 0n },
      plans: {
        some: {
          active: true,
          publicationStatus: "PUBLISHED",
          offerSource: "API_CATALOG",
          deliveryMode: "MANAGED",
        },
      },
    },
    select: { providerMonthlyPriceIrr: true },
    take: 5_000,
  });
  return items
    .map((item) => item.providerMonthlyPriceIrr)
    .filter((value): value is bigint => value != null && value > 0n);
}

export async function rollbackFinanceConfiguration(params: {
  revisionId: string;
  actorUserId: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
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
    idempotencyKey: params.idempotencyKey,
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
      const included = Array.isArray(item.includedServices)
        ? item.includedServices.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      const excluded = Array.isArray(item.excludedServices)
        ? item.excludedServices.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      return {
        level: item.level as ParchinLevel,
        title: String(item.title ?? ""),
        subtitle: typeof item.subtitle === "string" ? item.subtitle : null,
        description:
          typeof item.description === "string" ? item.description : null,
        priceRial: BigInt(String(item.priceRial ?? "0")),
        active: item.active === true,
        // Empty arrays in older Finance Center snapshots mean "fields were
        // omitted", not "wipe services". Leave undefined so merge restores
        // live contract lists on rollback.
        includedServices: included.length > 0 ? included : undefined,
        excludedServices: excluded.length > 0 ? excluded : undefined,
        supportWindow:
          typeof item.supportWindow === "string" ? item.supportWindow : null,
        firstResponseTarget:
          typeof item.firstResponseTarget === "string"
            ? item.firstResponseTarget
            : null,
      };
    }),
    priceDisplay: {
      showHourlyPrice: priceDisplay.showHourlyPrice !== false,
      showDailyPrice: priceDisplay.showDailyPrice !== false,
      showMonthlyPrice: priceDisplay.showMonthlyPrice !== false,
    },
    profitCurve:
      parseProfitCurveConfig(value.profitCurve) ?? defaultProfitCurveConfig(),
  };
}

type CandidatePricingContext = {
  providerMarkupBps: Map<string, { markupBps: number; enabled: boolean }>;
  productMarkupBps: Map<string, { markupBps: number; enabled: boolean }>;
  parchinPriceByLevel: Map<ParchinLevel, bigint>;
  parchinActiveByLevel: Map<ParchinLevel, boolean>;
  taxBps: number;
  profitCurve: ProfitCurveConfigInput;
  minimumPostDiscountGrossMarginBps: number;
};

function candidateContext(input: FinanceConfigurationInput): CandidatePricingContext {
  const profitCurve = resolveProfitCurveOrDefault(input);
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
    profitCurve,
    minimumPostDiscountGrossMarginBps:
      profitCurve.minimumPostDiscountGrossMarginBps,
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
): {
  finalPriceRial: bigint;
  sellable: boolean;
  providerCostRial: bigint | null;
  effectiveMarginBps: number | null;
  grossProfitRial: bigint | null;
} | null {
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
  const providerCostRial = catalogItemBasePriceRial(plan.catalogItem);
  if (providerCostRial == null || providerCostRial <= 0n) return null;

  const markup = resolveProviderMarkupForPlan({
    plan,
    providerMonthlyCostRial: providerCostRial,
    providerConfigMarkupBps: provider.markupBps,
    profitCurve: context.profitCurve,
  });
  const productMarkup =
    plan.skuMarkupBasisPoints ?? product?.markupBps ?? 0;

  const priced = resolveCatalogItemPricing(
    plan.catalogItem,
    { markupBasisPoints: markup.providerMarkupBps },
    {
      productMarkupBasisPoints: productMarkup,
      taxBasisPoints: context.taxBps,
      parchinLevel,
      parchinPriceRial: context.parchinPriceByLevel.get(parchinLevel) ?? 0n,
      termMonths: 1,
      minimumPostDiscountGrossMarginBps:
        context.minimumPostDiscountGrossMarginBps,
      infrastructureSaleRialOverride: markup.infrastructureSaleRialOverride,
    },
  );
  if (!priced) return null;
  const infraSale =
    priced.providerBasePriceRial + priced.markupAmountRial;
  const grossProfit = infraSale - priced.providerBasePriceRial;
  const effectiveMarginBps =
    infraSale > 0n
      ? Number((grossProfit * 10_000n + infraSale / 2n) / infraSale)
      : null;
  return {
    finalPriceRial: priced.finalPriceRial,
    sellable,
    providerCostRial,
    effectiveMarginBps,
    grossProfitRial: grossProfit,
  };
}

function candidateAsPricingConfigs(
  input: FinanceConfigurationInput,
): PricingConfigs {
  const now = new Date();
  const profitCurve = resolveProfitCurveOrDefault(input);
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
      minimumPostDiscountGrossMarginBps:
        profitCurve.minimumPostDiscountGrossMarginBps,
      compassServicePrices: input.compassServicePrices,
      updatedById: null,
      updatedAt: now,
    },
    parchin: input.parchin
      .filter((item) => item.active)
      .map((item, index) => ({
        id: `parchin:${item.level}`,
        level: item.level,
        version: 1,
        title: item.title,
        subtitle: item.subtitle ?? null,
        description: item.description,
        priceRial: item.priceRial,
        includedServices: item.includedServices ?? [],
        excludedServices: item.excludedServices ?? [],
        serviceLimits: {},
        supportWindow: item.supportWindow ?? null,
        firstResponseTarget: item.firstResponseTarget ?? null,
        active: item.active,
        effectiveFrom: now,
        sortOrder: index,
        updatedById: null,
        createdAt: now,
        updatedAt: now,
      })),
    profitCurve,
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
  currentEffectiveMarginBps?: number | null;
  candidateEffectiveMarginBps?: number | null;
  grossProfitRial?: string | null;
  providerCostRial?: string | null;
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
      subtitle: item.subtitle,
      description: item.description,
      priceRial: BigInt(item.priceRial),
      active: item.active,
      includedServices: Array.isArray(item.includedServices)
        ? (item.includedServices as string[])
        : [],
      excludedServices: Array.isArray(item.excludedServices)
        ? (item.excludedServices as string[])
        : [],
      supportWindow: item.supportWindow,
      firstResponseTarget: item.firstResponseTarget,
    })),
    priceDisplay: current.priceDisplay,
    profitCurve:
      parseProfitCurveConfig(current.profitCurve) ?? defaultProfitCurveConfig(),
  };
  const candidateCtx = candidateContext(input);
  const currentCtx = candidateContext(currentInput);
  const plans = await samplePlansForImpact(200);
  const catalogCosts = plans
    .map((plan) =>
      plan.catalogItem ? catalogItemBasePriceRial(plan.catalogItem) : null,
    )
    .filter((value): value is bigint => value != null && value > 0n);
  const mono = validateProfitCurveMonotonicity(
    resolveProfitCurveOrDefault(input).bands,
    { catalogCostsRial: catalogCosts, syntheticPoints: 2_000 },
  );

  const rows: FinanceImpactRow[] = [];
  let increased = 0;
  let decreased = 0;
  let unchanged = 0;
  let marginSumCurrent = 0;
  let marginSumCandidate = 0;
  let marginCount = 0;
  let minGrossProfit: bigint | null = null;
  let maxGrossProfit: bigint | null = null;

  const currentDominanceCandidates = [];
  const candidateDominanceCandidates = [];

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
    if (
      currentPrice?.effectiveMarginBps != null &&
      candidatePrice?.effectiveMarginBps != null
    ) {
      marginSumCurrent += currentPrice.effectiveMarginBps;
      marginSumCandidate += candidatePrice.effectiveMarginBps;
      marginCount += 1;
    }
    if (candidatePrice?.grossProfitRial != null) {
      if (minGrossProfit == null || candidatePrice.grossProfitRial < minGrossProfit) {
        minGrossProfit = candidatePrice.grossProfitRial;
      }
      if (maxGrossProfit == null || candidatePrice.grossProfitRial > maxGrossProfit) {
        maxGrossProfit = candidatePrice.grossProfitRial;
      }
    }

    const baseTraits = {
      id: plan.id,
      locationKey: plan.regionCode,
      productKind: plan.productKind,
      deliveryMode: plan.deliveryMode,
      purchasable: Boolean(candidatePrice?.sellable),
      vcpu: plan.vcpu,
      ramGb: plan.ramGb,
      diskGb: plan.storageGb,
      checkedAtMs: plan.updatedAt.getTime(),
      traits: {
        transferKey: null as string | null,
        diskTypeKey: null as string | null,
        ipv4Key: null as string | null,
        ipv6Key: null as string | null,
      },
    };
    if (currentFinal != null) {
      currentDominanceCandidates.push({
        ...baseTraits,
        purchasable: Boolean(currentPrice?.sellable),
        finalMonthlyPriceRial: currentFinal,
      });
    }
    if (candidateFinal != null) {
      candidateDominanceCandidates.push({
        ...baseTraits,
        finalMonthlyPriceRial: candidateFinal,
      });
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
      currentEffectiveMarginBps: currentPrice?.effectiveMarginBps ?? null,
      candidateEffectiveMarginBps: candidatePrice?.effectiveMarginBps ?? null,
      grossProfitRial: candidatePrice?.grossProfitRial?.toString() ?? null,
      providerCostRial: candidatePrice?.providerCostRial?.toString() ?? null,
    });
  }

  const currentDom = filterDominatedPlans(currentDominanceCandidates);
  const candidateDom = filterDominatedPlans(candidateDominanceCandidates);
  const currentDominated = currentDom.removed.filter(
    (row) => row.reason === "DOMINATED" || row.reason === "DUPLICATE_EQUAL",
  ).length;
  const candidateDominated = candidateDom.removed.filter(
    (row) => row.reason === "DOMINATED" || row.reason === "DUPLICATE_EQUAL",
  ).length;

  const withDelta = rows.filter((row) => row.deltaRial != null);
  const sortedByDelta = [...withDelta].sort((a, b) => {
    const deltaA = BigInt(a.deltaRial ?? "0");
    const deltaB = BigInt(b.deltaRial ?? "0");
    return deltaA === deltaB ? 0 : deltaA > deltaB ? -1 : 1;
  });
  const largestIncrease = sortedByDelta.find(
    (row) => BigInt(row.deltaRial ?? "0") > 0n,
  );
  const largestDecrease = [...sortedByDelta]
    .reverse()
    .find((row) => BigInt(row.deltaRial ?? "0") < 0n);

  return {
    sampledPlans: rows.length,
    affectedPlans: increased + decreased,
    increasedPlans: increased,
    decreasedPlans: decreased,
    unchangedPlans: unchanged,
    notSellablePlans: rows.filter((row) => !row.sellable).length,
    plansBecomingCheaper: decreased,
    plansBecomingMoreExpensive: increased,
    largestIncrease: largestIncrease ?? null,
    largestDecrease: largestDecrease ?? null,
    averagePreviousEffectiveMarginBps:
      marginCount > 0 ? Math.round(marginSumCurrent / marginCount) : null,
    averageNewEffectiveMarginBps:
      marginCount > 0 ? Math.round(marginSumCandidate / marginCount) : null,
    minimumGrossProfitRial: minGrossProfit?.toString() ?? null,
    maximumGrossProfitRial: maxGrossProfit?.toString() ?? null,
    dominatedPlanCountCurrent: currentDominated,
    dominatedPlanCountNew: candidateDominated,
    newlyDominatedPlanCount: Math.max(0, candidateDominated - currentDominated),
    newlyVisiblePlanCount: Math.max(0, currentDominated - candidateDominated),
    monotonicity: {
      ok: mono.ok,
      sampled: mono.sampled,
      failures: mono.issues.slice(0, 20),
    },
    topIncreases: sortedByDelta
      .filter((row) => BigInt(row.deltaRial ?? "0") > 0n)
      .slice(0, 10),
    topDecreases: sortedByDelta
      .filter((row) => BigInt(row.deltaRial ?? "0") < 0n)
      .reverse()
      .slice(0, 10),
    topAffected: sortedByDelta
      .slice()
      .sort((a, b) => {
        const absA =
          BigInt(a.deltaRial ?? "0") < 0n
            ? -BigInt(a.deltaRial ?? "0")
            : BigInt(a.deltaRial ?? "0");
        const absB =
          BigInt(b.deltaRial ?? "0") < 0n
            ? -BigInt(b.deltaRial ?? "0")
            : BigInt(b.deltaRial ?? "0");
        return absA === absB ? 0 : absA > absB ? -1 : 1;
      })
      .slice(0, 10),
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
  curve: ReturnType<typeof resolveProfitCurve> | null;
  productOverrideMarkupBps: number;
  finalInfrastructureMarginBps: number;
} {
  const context = candidateContext(input);
  const provider = context.providerMarkupBps.get(request.provider);
  const product = context.productMarkupBps.get(
    `${request.provider}:${request.productKind}`,
  );
  const markup = resolveProviderMarkupForPlan({
    plan: {
      offerSource: "API_CATALOG",
      productKind: request.productKind,
    },
    providerMonthlyCostRial: request.providerMonthlyCostRial,
    providerConfigMarkupBps: provider?.markupBps ?? 0,
    profitCurve: context.profitCurve,
  });
  const productOverrideMarkupBps = product?.markupBps ?? 0;
  const breakdown = computeCommercialPriceBreakdown({
    providerMonthlyPriceIrr: request.providerMonthlyCostRial,
    providerMarkupBps: markup.providerMarkupBps,
    productMarkupBps: productOverrideMarkupBps,
    parchinLevel: request.parchinLevel,
    parchinPriceIrr:
      context.parchinPriceByLevel.get(request.parchinLevel) ?? 0n,
    taxBps: context.taxBps,
    termMonths: request.termMonths,
    couponDiscountBps: request.couponDiscountBps ?? null,
    minimumPostDiscountGrossMarginBps:
      context.minimumPostDiscountGrossMarginBps,
    infrastructureSaleRialOverride: markup.infrastructureSaleRialOverride,
  });
  return {
    breakdown,
    providerEnabled: provider?.enabled ?? false,
    productEnabled: product?.enabled ?? false,
    curve: markup.curve,
    productOverrideMarkupBps,
    finalInfrastructureMarginBps: breakdown.grossMarginBps,
  };
}
