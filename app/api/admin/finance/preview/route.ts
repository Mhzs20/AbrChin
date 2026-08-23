import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
} from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import {
  FinanceConfigurationError,
  checkCardQuoteParity,
  previewFinanceImpact,
  simulateFinanceBreakdown,
  validateFinanceConfiguration,
  type FinanceConfigurationInput,
  type FinanceSimulatorRequest,
} from "@/lib/admin/finance-configuration";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  evaluateMarginGuardrail,
  grossMarginBpsToMarkupBps,
  serializeQuoteLineItems,
} from "@/lib/pricing/commercial-engine";
import { parseProfitCurveConfig } from "@/lib/pricing/profit-curve";

export const dynamic = "force-dynamic";

function parseCandidate(raw: unknown): FinanceConfigurationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid_candidate");
  }
  const value = raw as Record<string, unknown>;
  const providers = Array.isArray(value.providers) ? value.providers : [];
  const productMarkups = Array.isArray(value.productMarkups)
    ? value.productMarkups
    : [];
  const parchin = Array.isArray(value.parchin) ? value.parchin : [];
  const priceDisplay =
    value.priceDisplay && typeof value.priceDisplay === "object"
      ? (value.priceDisplay as Record<string, unknown>)
      : {};
  const profitCurve =
    value.profitCurve == null
      ? undefined
      : parseProfitCurveConfig(value.profitCurve);
  if (value.profitCurve != null && !profitCurve) {
    throw new Error("invalid_candidate");
  }
  return {
    providers: providers.map((row) => {
      const item = row as Record<string, unknown>;
      if (item.provider !== InfrastructureProvider.ARVAN) {
        throw new Error("invalid_candidate");
      }
      return {
        provider: item.provider,
        targetGrossMarginBps: Number(item.targetGrossMarginBps),
        enabled: item.enabled === true,
      };
    }),
    productMarkups: productMarkups.map((row) => {
      const item = row as Record<string, unknown>;
      if (
        item.provider !== InfrastructureProvider.ARVAN ||
        !Object.values(InfrastructureProductKind).includes(
          item.productKind as InfrastructureProductKind,
        )
      ) {
        throw new Error("invalid_candidate");
      }
      return {
        provider: item.provider,
        productKind: item.productKind as InfrastructureProductKind,
        markupBasisPoints: Number(item.markupBasisPoints),
        enabled: item.enabled === true,
      };
    }),
    taxBps: Number(value.taxBps),
    reminderDaysBeforeDue: Number(value.reminderDaysBeforeDue ?? 7),
    suspendGraceDaysAfterZero: Number(value.suspendGraceDaysAfterZero ?? 7),
    deleteDaysAfterSuspend: Number(value.deleteDaysAfterSuspend ?? 7),
    compassServicePrices:
      value.compassServicePrices &&
      typeof value.compassServicePrices === "object" &&
      !Array.isArray(value.compassServicePrices)
        ? (value.compassServicePrices as Record<string, string>)
        : {},
    parchin: parchin.map((row) => {
      const item = row as Record<string, unknown>;
      if (!Object.values(ParchinLevel).includes(item.level as ParchinLevel)) {
        throw new Error("invalid_candidate");
      }
      const priceRial = String(item.priceRial ?? "0");
      if (!/^\d+$/.test(priceRial)) throw new Error("invalid_candidate");
      return {
        level: item.level as ParchinLevel,
        title: String(item.title ?? ""),
        description:
          typeof item.description === "string" ? item.description : null,
        priceRial: BigInt(priceRial),
        active: item.active === true,
      };
    }),
    priceDisplay: {
      showHourlyPrice: priceDisplay.showHourlyPrice !== false,
      showDailyPrice: priceDisplay.showDailyPrice !== false,
      showMonthlyPrice: priceDisplay.showMonthlyPrice !== false,
    },
    profitCurve: profitCurve ?? undefined,
  };
}

function parseSimulator(raw: unknown): FinanceSimulatorRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const cost = String(value.providerMonthlyCostRial ?? "");
  if (!/^\d+$/.test(cost) || BigInt(cost) <= 0n) return null;
  const term = Number(value.termMonths);
  if (term !== 1 && term !== 3 && term !== 6 && term !== 12) return null;
  if (value.provider !== InfrastructureProvider.ARVAN) {
    return null;
  }
  if (
    !Object.values(InfrastructureProductKind).includes(
      value.productKind as InfrastructureProductKind,
    ) ||
    !Object.values(ParchinLevel).includes(value.parchinLevel as ParchinLevel)
  ) {
    return null;
  }
  const couponRaw = value.couponDiscountBps;
  const couponDiscountBps =
    couponRaw == null || couponRaw === ""
      ? null
      : Number.isInteger(Number(couponRaw)) &&
          Number(couponRaw) >= 0 &&
          Number(couponRaw) <= 10_000
        ? Number(couponRaw)
        : null;
  return {
    providerMonthlyCostRial: BigInt(cost),
    provider: value.provider,
    productKind: value.productKind as InfrastructureProductKind,
    termMonths: term,
    parchinLevel: value.parchinLevel as ParchinLevel,
    couponDiscountBps,
  };
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    await requireAdminUser();
    const body = (await request.json()) as {
      candidate?: unknown;
      simulator?: unknown;
      includeImpact?: unknown;
    };
    const candidate = parseCandidate(body.candidate);
    // Margin bounds are enforced here too so the preview rejects <0 / ≥100%.
    let guardrail: "ok" | "warn" | "confirm" = "ok";
    try {
      guardrail = validateFinanceConfiguration(candidate, {
        skipHighMarginConfirmation: true,
      }).guardrail;
    } catch (error) {
      if (
        error instanceof FinanceConfigurationError &&
        error.code === "invalid_margin"
      ) {
        return jsonError(error.message, 400, { code: error.code });
      }
      throw error;
    }

    const simulatorRequest = parseSimulator(body.simulator);
    const simulation = simulatorRequest
      ? simulateFinanceBreakdown(candidate, simulatorRequest)
      : null;

    const includeImpact = body.includeImpact === true;
    const [impact, parity] = includeImpact
      ? await Promise.all([
          previewFinanceImpact(candidate),
          checkCardQuoteParity(candidate),
        ])
      : [null, null];

    return jsonOk({
      guardrails: {
        level: guardrail,
        providerLevels: candidate.providers.map((item) => ({
          provider: item.provider,
          marginBps: item.targetGrossMarginBps,
          markupBps: grossMarginBpsToMarkupBps(item.targetGrossMarginBps),
          level: evaluateMarginGuardrail(item.targetGrossMarginBps).level,
        })),
      },
      simulation: simulation
        ? {
            providerEnabled: simulation.providerEnabled,
            productEnabled: simulation.productEnabled,
            breakdown: {
              providerCostRial:
                simulation.breakdown.providerCostRial.toString(),
              providerMarkupRial:
                simulation.breakdown.providerMarkupRial.toString(),
              productMarkupRial:
                simulation.breakdown.productMarkupRial.toString(),
              totalMarkupRial: simulation.breakdown.totalMarkupRial.toString(),
              parchinRial: simulation.breakdown.parchinRial.toString(),
              addonsRial: simulation.breakdown.addonsRial.toString(),
              subtotalBeforeDiscountRial:
                simulation.breakdown.subtotalBeforeDiscountRial.toString(),
              discountRial: simulation.breakdown.discountRial.toString(),
              taxableRial: simulation.breakdown.taxableRial.toString(),
              taxRial: simulation.breakdown.taxRial.toString(),
              finalPriceRial: simulation.breakdown.finalPriceRial.toString(),
              renewalPriceRial:
                simulation.breakdown.renewalPriceRial.toString(),
              effectiveMarkupBps: simulation.breakdown.effectiveMarkupBps,
              grossMarginBps: simulation.breakdown.grossMarginBps,
              termMonths: simulation.breakdown.termMonths,
              termDiscountBps: simulation.breakdown.termDiscountBps,
              discountSource: simulation.breakdown.discountSource,
              lineItems: serializeQuoteLineItems(
                simulation.breakdown.lineItems,
              ),
            },
          }
        : null,
      impact,
      parity,
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (error instanceof FinanceConfigurationError) {
      return jsonError(error.message, 400, { code: error.code });
    }
    if (error instanceof SyntaxError) {
      return jsonError("بدنه درخواست معتبر نیست.", 400);
    }
    if (error instanceof Error && error.message === "invalid_candidate") {
      return jsonError("تنظیمات پیش‌نمایش معتبر نیست.", 400);
    }
    console.error(
      "[admin/finance/preview]",
      error instanceof Error ? error.message : "unknown",
    );
    return jsonError("پیش‌نمایش قیمت ممکن نیست.", 500);
  }
}
