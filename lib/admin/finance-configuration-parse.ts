import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
} from "@prisma/client";

import type { FinanceConfigurationInput } from "@/lib/admin/finance-configuration";
import {
  parseProfitCurveConfig,
  type ProfitCurveBandInput,
} from "@/lib/pricing/profit-curve";

function parseProfitCurveBody(raw: unknown) {
  if (raw == null) return undefined;
  const parsed = parseProfitCurveConfig(raw);
  if (!parsed) throw new Error("invalid_configuration_body");
  const bands: ProfitCurveBandInput[] = parsed.bands.map((band, index) => ({
    ...band,
    sortOrder: Number.isInteger(band.sortOrder) ? band.sortOrder : index,
  }));
  return { ...parsed, bands };
}

/** Strict body parser for PATCH /api/admin/finance/configuration. */
export function parseFinanceConfigurationBody(
  body: Record<string, unknown>,
): FinanceConfigurationInput {
  const providers = Array.isArray(body.providers) ? body.providers : [];
  const productMarkups = Array.isArray(body.productMarkups)
    ? body.productMarkups
    : [];
  const parchin = Array.isArray(body.parchin) ? body.parchin : [];
  const priceDisplay =
    body.priceDisplay && typeof body.priceDisplay === "object"
      ? (body.priceDisplay as Record<string, unknown>)
      : {};
  if (providers.length === 0) throw new Error("invalid_configuration_body");
  return {
    providers: providers.map((row) => {
      const item = row as Record<string, unknown>;
      if (
        item.provider !== InfrastructureProvider.ARVAN &&
        item.provider !== InfrastructureProvider.PARSPACK
      ) {
        throw new Error("invalid_configuration_body");
      }
      const margin = Number(item.targetGrossMarginBps);
      if (!Number.isInteger(margin)) {
        throw new Error("invalid_configuration_body");
      }
      return {
        provider: item.provider,
        targetGrossMarginBps: margin,
        enabled: item.enabled === true,
      };
    }),
    productMarkups: productMarkups.map((row) => {
      const item = row as Record<string, unknown>;
      if (
        (item.provider !== InfrastructureProvider.ARVAN &&
          item.provider !== InfrastructureProvider.PARSPACK) ||
        !Object.values(InfrastructureProductKind).includes(
          item.productKind as InfrastructureProductKind,
        ) ||
        !Number.isInteger(Number(item.markupBasisPoints))
      ) {
        throw new Error("invalid_configuration_body");
      }
      return {
        provider: item.provider,
        productKind: item.productKind as InfrastructureProductKind,
        markupBasisPoints: Number(item.markupBasisPoints),
        enabled: item.enabled === true,
      };
    }),
    taxBps: Number(body.taxBps),
    reminderDaysBeforeDue: Number(body.reminderDaysBeforeDue),
    suspendGraceDaysAfterZero: Number(body.suspendGraceDaysAfterZero),
    deleteDaysAfterSuspend: Number(body.deleteDaysAfterSuspend),
    compassServicePrices: (() => {
      const raw =
        body.compassServicePrices &&
        typeof body.compassServicePrices === "object" &&
        !Array.isArray(body.compassServicePrices)
          ? (body.compassServicePrices as Record<string, unknown>)
          : {};
      const parsed: Record<string, string> = {};
      for (const code of [
        "SITE_MIGRATION",
        "INITIAL_SETUP",
        "DOMAIN_SSL",
        "BACKUP_RESTORE",
        "ARCHITECTURE_LIGHT",
      ]) {
        const value = String(raw[code] ?? "0");
        if (!/^\d+$/.test(value)) throw new Error("invalid_configuration_body");
        parsed[code] = value;
      }
      return parsed;
    })(),
    parchin: parchin.map((row) => {
      const item = row as Record<string, unknown>;
      if (!Object.values(ParchinLevel).includes(item.level as ParchinLevel)) {
        throw new Error("invalid_configuration_body");
      }
      const priceRial = String(item.priceRial ?? "");
      if (!/^\d+$/.test(priceRial)) throw new Error("invalid_configuration_body");
      return {
        level: item.level as ParchinLevel,
        title: typeof item.title === "string" ? item.title.trim() : "",
        description:
          typeof item.description === "string" ? item.description.trim() : null,
        priceRial: BigInt(priceRial),
        active: item.active === true,
      };
    }),
    priceDisplay: {
      showHourlyPrice: priceDisplay.showHourlyPrice !== false,
      showDailyPrice: priceDisplay.showDailyPrice !== false,
      showMonthlyPrice: priceDisplay.showMonthlyPrice !== false,
    },
    profitCurve: parseProfitCurveBody(body.profitCurve),
    reason: typeof body.reason === "string" ? body.reason : null,
    highMarginConfirmation:
      typeof body.highMarginConfirmation === "string"
        ? body.highMarginConfirmation
        : null,
  };
}
