"use client";

import { useMemo } from "react";

import { SectionCard } from "@/components/product";
import {
  grossMarginBpsToMarkupBps,
} from "@/lib/pricing/commercial-engine";
import {
  deriveProfitCurveTransitions,
  resolveProfitCurve,
  saleMultiplierBpsFromMargin,
  type ProfitCurveBandInput,
} from "@/lib/pricing/profit-curve";

export type ProfitCurveBandDraft = {
  id: string;
  sortOrder: number;
  minCostToman: string;
  maxCostToman: string; // empty = unbounded
  marginPercent: string;
};

export type ProfitCurveImpactSummary = {
  sampledPlans: number;
  affectedPlans: number;
  increasedPlans: number;
  decreasedPlans: number;
  unchangedPlans: number;
  plansBecomingCheaper?: number;
  plansBecomingMoreExpensive?: number;
  averagePreviousEffectiveMarginBps?: number | null;
  averageNewEffectiveMarginBps?: number | null;
  minimumGrossProfitRial?: string | null;
  maximumGrossProfitRial?: string | null;
  dominatedPlanCountCurrent?: number;
  dominatedPlanCountNew?: number;
  newlyDominatedPlanCount?: number;
  newlyVisiblePlanCount?: number;
  monotonicity?: {
    ok: boolean;
    sampled: number;
    failures: Array<{ code: string; message: string }>;
  };
  largestIncrease?: ImpactLite | null;
  largestDecrease?: ImpactLite | null;
  topAffected?: ImpactLite[];
  topIncreases?: ImpactLite[];
  topDecreases?: ImpactLite[];
  rows?: Array<ImpactLite & { providerCostRial?: string | null }>;
};

type ImpactLite = {
  planId: string;
  title: string;
  provider: string;
  currentFinalRial: string | null;
  candidateFinalRial: string | null;
  deltaRial: string | null;
  deltaBps: number | null;
  sellable: boolean;
  providerCostRial?: string | null;
};

function percentToBps(percent: string): number | null {
  const raw = percent.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const bps =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 100_000) return null;
  return bps;
}

function bpsToPercent(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

function faDigits(value: string) {
  const cleaned = value.replace(/[^\d]/g, "");
  if (!cleaned) return "";
  return Number(cleaned).toLocaleString("fa-IR");
}

function formatTomanFromRialString(rial: string) {
  try {
    const value = BigInt(rial);
    const negative = value < 0n;
    const toman = (negative ? -value : value) / 10n;
    return `${negative ? "−" : ""}${toman.toLocaleString("fa-IR")} تومان`;
  } catch {
    return "—";
  }
}

function draftsToBands(drafts: ProfitCurveBandDraft[]): ProfitCurveBandInput[] | null {
  const bands: ProfitCurveBandInput[] = [];
  for (const draft of drafts) {
    const margin = percentToBps(draft.marginPercent);
    if (margin == null) return null;
    const minToman = draft.minCostToman.replace(/[^\d]/g, "") || "0";
    const maxToman = draft.maxCostToman.replace(/[^\d]/g, "");
    bands.push({
      id: draft.id,
      sortOrder: draft.sortOrder,
      minProviderCostRial: BigInt(minToman) * 10n,
      maxProviderCostRial: maxToman ? BigInt(maxToman) * 10n : null,
      targetGrossMarginBps: margin,
    });
  }
  return bands;
}

export function ProfitCurvePanelSection({
  enabled,
  onEnabledChange,
  bands,
  onBandsChange,
  floorPercent,
  onFloorChange,
  activeRevisionId,
  updatedAt,
  impact,
  impactLoading,
  onPreviewImpact,
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  bands: ProfitCurveBandDraft[];
  onBandsChange: (bands: ProfitCurveBandDraft[]) => void;
  floorPercent: string;
  onFloorChange: (value: string) => void;
  activeRevisionId: string | null;
  updatedAt: string | null;
  impact: ProfitCurveImpactSummary | null;
  impactLoading: boolean;
  onPreviewImpact: () => void;
}) {
  const parsedBands = useMemo(() => draftsToBands(bands), [bands]);
  const transitions = useMemo(() => {
    if (!parsedBands) return [];
    try {
      return deriveProfitCurveTransitions(parsedBands);
    } catch {
      return [];
    }
  }, [parsedBands]);

  const marginRange = useMemo(() => {
    const values = bands
      .map((band) => percentToBps(band.marginPercent))
      .filter((value): value is number => value != null);
    if (values.length === 0) return { min: null as number | null, max: null as number | null };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [bands]);

  const bandPlanCounts = useMemo(() => {
    const counts = bands.map(() => 0);
    if (!parsedBands || !impact?.rows) return counts;
    for (const row of impact.rows) {
      const costRaw = row.providerCostRial;
      if (!costRaw || !/^\d+$/.test(costRaw)) continue;
      const cost = BigInt(costRaw);
      for (let i = 0; i < parsedBands.length; i += 1) {
        const band = parsedBands[i]!;
        const inBand =
          cost >= band.minProviderCostRial &&
          (band.maxProviderCostRial == null || cost < band.maxProviderCostRial);
        if (inBand) {
          counts[i] = (counts[i] ?? 0) + 1;
          break;
        }
      }
    }
    return counts;
  }, [impact, bands, parsedBands]);

  const chartPoints = useMemo(() => {
    if (!parsedBands) return [];
    const maxCost =
      parsedBands[parsedBands.length - 1]!.minProviderCostRial * 2n ||
      50_000_000n * 10n;
    const points: Array<{
      cost: number;
      sale: number;
      margin: number;
    }> = [];
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const cost =
        i === 0 ? 1n : (maxCost * BigInt(i)) / BigInt(steps);
      try {
        const resolved = resolveProfitCurve({
          providerMonthlyCostRial: cost,
          bands: parsedBands,
        });
        points.push({
          cost: Number(cost / 10n),
          sale: Number(resolved.infrastructureSaleRial / 10n),
          margin: resolved.effectiveGrossMarginBps / 100,
        });
      } catch {
        // skip invalid point
      }
    }
    return points;
  }, [parsedBands]);

  function updateBand(index: number, patch: Partial<ProfitCurveBandDraft>) {
    onBandsChange(
      bands.map((band, i) => (i === index ? { ...band, ...patch } : band)),
    );
  }

  const width = 420;
  const height = 180;
  const pad = 24;
  const maxCost = Math.max(...chartPoints.map((p) => p.cost), 1);
  const maxSale = Math.max(...chartPoints.map((p) => p.sale), 1);

  function xOf(cost: number) {
    return pad + ((cost / maxCost) * (width - pad * 2));
  }
  function ySale(sale: number) {
    return height - pad - (sale / maxSale) * (height - pad * 2);
  }
  function yMargin(margin: number) {
    return height - pad - (margin / 100) * (height - pad * 2);
  }

  const salePath = chartPoints
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${xOf(point.cost).toFixed(1)},${ySale(point.sale).toFixed(1)}`,
    )
    .join(" ");
  const marginPath = chartPoints
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${xOf(point.cost).toFixed(1)},${yMargin(point.margin).toFixed(1)}`,
    )
    .join(" ");

  return (
    <section
      id="finance-panel-profit-curve"
      role="tabpanel"
      aria-labelledby="finance-tab-profit-curve"
      className="finance-section"
    >
      <SectionCard title="خلاصه منحنی سود فعال">
        <div className="finance-overview" role="list">
          <div className="finance-overview-chip" role="listitem">
            <span>نسخه فعال</span>
            <strong className="product-tech">
              {activeRevisionId ? activeRevisionId.slice(0, 10) : "پیش‌فرض"}
            </strong>
            <small>
              {updatedAt
                ? new Date(updatedAt).toLocaleString("fa-IR")
                : "هنوز منتشر نشده"}
            </small>
          </div>
          <div className="finance-overview-chip" role="listitem">
            <span>بازه حاشیه هدف</span>
            <strong className="money-tone--sale">
              {marginRange.min != null && marginRange.max != null
                ? `${bpsToPercent(marginRange.min)}٪ – ${bpsToPercent(marginRange.max)}٪`
                : "—"}
            </strong>
            <small>پنج بازه هزینه خرید</small>
          </div>
          <div className="finance-overview-chip" role="listitem">
            <span>کف حاشیه پس از تخفیف</span>
            <strong>{floorPercent || "—"}٪</strong>
            <small>حداقل حاشیه ناخالص پس از تخفیف</small>
          </div>
          <div className="finance-overview-chip" role="listitem">
            <span>پلن‌های تحت تأثیر</span>
            <strong>
              {impact
                ? impact.affectedPlans.toLocaleString("fa-IR")
                : "—"}
            </strong>
            <small>
              {impact
                ? `از ${impact.sampledPlans.toLocaleString("fa-IR")} پلن نمونه`
                : "پیش‌نمایش اثر را بزن"}
            </small>
          </div>
        </div>
        <label className="pricing-check" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          منحنی سود برای فروش سرورهای API فعال باشد
        </label>
      </SectionCard>

      <SectionCard title="ویرایش پنج بازه">
        <p className="pricing-rules-lead">
          مبالغ به تومان نمایش داده می‌شوند؛ موتور داخلی ریال نگه می‌دارد (×۱۰).
          انتقال بین بازه‌ها خودکار و بدون پرش قیمت است.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="product-table profit-curve-table">
            <thead>
              <tr>
                <th>از هزینه خرید</th>
                <th>تا هزینه خرید</th>
                <th>حاشیه سود هدف</th>
                <th>Markup معادل</th>
                <th>ضریب فروش</th>
                <th>Transition خودکار</th>
                <th>تعداد پلن‌های این بازه</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((band, index) => {
                const marginBps = percentToBps(band.marginPercent);
                const markup =
                  marginBps != null && marginBps < 10_000
                    ? bpsToPercent(grossMarginBpsToMarkupBps(marginBps))
                    : null;
                const multiplier =
                  marginBps != null && marginBps < 10_000
                    ? (
                        saleMultiplierBpsFromMargin(marginBps) / 10_000
                      ).toFixed(2)
                    : null;
                const transition = transitions.find((t) => t.bandIndex === index);
                return (
                  <tr key={band.id}>
                    <td>
                      <input
                        className="profit-curve-input"
                        inputMode="numeric"
                        disabled={index === 0}
                        value={band.minCostToman}
                        onChange={(event) =>
                          updateBand(index, {
                            minCostToman: event.target.value.replace(/\D/g, ""),
                          })
                        }
                      />
                      <small className="pricing-field-hint">
                        {faDigits(band.minCostToman)
                          ? `${faDigits(band.minCostToman)} تومان`
                          : "۰"}
                      </small>
                    </td>
                    <td>
                      {index === bands.length - 1 ? (
                        <span className="product-muted">بدون سقف</span>
                      ) : (
                        <>
                          <input
                            className="profit-curve-input"
                            inputMode="numeric"
                            value={band.maxCostToman}
                            onChange={(event) => {
                              const nextMax = event.target.value.replace(
                                /\D/g,
                                "",
                              );
                              const next = bands.map((row, i) => {
                                if (i === index) {
                                  return { ...row, maxCostToman: nextMax };
                                }
                                if (i === index + 1) {
                                  return { ...row, minCostToman: nextMax };
                                }
                                return row;
                              });
                              onBandsChange(next);
                            }}
                          />
                          <small className="pricing-field-hint">
                            {faDigits(band.maxCostToman)
                              ? `${faDigits(band.maxCostToman)} تومان`
                              : "—"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        className="profit-curve-input"
                        inputMode="decimal"
                        value={band.marginPercent}
                        onChange={(event) =>
                          updateBand(index, {
                            marginPercent: event.target.value,
                          })
                        }
                      />
                      <small className="pricing-field-hint">٪</small>
                    </td>
                    <td className="money-tone money-tone--sale">
                      {markup ? `${markup}٪` : "—"}
                    </td>
                    <td>{multiplier ? `×${multiplier}` : "—"}</td>
                    <td>
                      {transition ? (
                        <span className="pricing-field-hint">
                          تا{" "}
                          {(
                            transition.transitionEndRial / 10n
                          ).toLocaleString("fa-IR")}{" "}
                          تومان
                        </span>
                      ) : (
                        <span className="product-muted">—</span>
                      )}
                    </td>
                    <td>{(bandPlanCounts[index] ?? 0).toLocaleString("fa-IR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="pricing-field" style={{ marginTop: 14, maxWidth: 280 }}>
          <span>کف حاشیه پس از تخفیف (٪)</span>
          <input
            inputMode="decimal"
            value={floorPercent}
            onChange={(event) => onFloorChange(event.target.value)}
          />
          <span className="pricing-field-hint">پیش‌فرض ۲۰٪ · محدوده ۱۰٪ تا ۷۵٪</span>
        </label>
      </SectionCard>

      <SectionCard title="نمودار هزینه خرید در برابر قیمت فروش">
        <svg
          className="profit-curve-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="منحنی سود: هزینه خرید در برابر قیمت فروش و حاشیه"
        >
          <line
            x1={pad}
            y1={height - pad}
            x2={width - pad}
            y2={height - pad}
            stroke="#c5d0e0"
          />
          <line
            x1={pad}
            y1={pad}
            x2={pad}
            y2={height - pad}
            stroke="#c5d0e0"
          />
          {salePath ? (
            <path d={salePath} fill="none" stroke="#1565c0" strokeWidth="2.2" />
          ) : null}
          {marginPath ? (
            <path
              d={marginPath}
              fill="none"
              stroke="#2e7d32"
              strokeWidth="1.6"
              strokeDasharray="4 3"
            />
          ) : null}
        </svg>
        <p className="finance-share-legend">
          <span className="finance-legend-item finance-legend-item--profit">
            قیمت فروش زیرساخت
          </span>
          <span className="finance-legend-item finance-legend-item--cost">
            حاشیه موثر (٪)
          </span>
        </p>
      </SectionCard>

      <SectionCard title="پیش‌نمایش اثر روی پلن‌های عمومی">
        <button
          type="button"
          className="product-btn product-btn--primary"
          disabled={impactLoading}
          onClick={onPreviewImpact}
        >
          {impactLoading ? "در حال محاسبه…" : "پیش‌نمایش اثر منحنی"}
        </button>
        {impact ? (
          <div className="finance-publish-review" style={{ marginTop: 12 }}>
            <p>
              ارزان‌تر:{" "}
              {(impact.plansBecomingCheaper ?? impact.decreasedPlans).toLocaleString(
                "fa-IR",
              )}{" "}
              · گران‌تر:{" "}
              {(
                impact.plansBecomingMoreExpensive ?? impact.increasedPlans
              ).toLocaleString("fa-IR")}{" "}
              · بدون تغییر: {impact.unchangedPlans.toLocaleString("fa-IR")}
            </p>
            {impact.largestIncrease ? (
              <p>
                بیشترین افزایش: {impact.largestIncrease.title} —{" "}
                {formatTomanFromRialString(
                  impact.largestIncrease.currentFinalRial ?? "0",
                )}{" "}
                ←{" "}
                {formatTomanFromRialString(
                  impact.largestIncrease.candidateFinalRial ?? "0",
                )}
              </p>
            ) : null}
            {impact.largestDecrease ? (
              <p>
                بیشترین کاهش: {impact.largestDecrease.title} —{" "}
                {formatTomanFromRialString(
                  impact.largestDecrease.currentFinalRial ?? "0",
                )}{" "}
                ←{" "}
                {formatTomanFromRialString(
                  impact.largestDecrease.candidateFinalRial ?? "0",
                )}
              </p>
            ) : null}
            <p>
              میانگین حاشیه قبلی:{" "}
              {impact.averagePreviousEffectiveMarginBps != null
                ? `${bpsToPercent(impact.averagePreviousEffectiveMarginBps)}٪`
                : "—"}{" "}
              → جدید:{" "}
              {impact.averageNewEffectiveMarginBps != null
                ? `${bpsToPercent(impact.averageNewEffectiveMarginBps)}٪`
                : "—"}
            </p>
            <p>
              حداقل/حداکثر سود ناخالص:{" "}
              {formatTomanFromRialString(
                impact.minimumGrossProfitRial ?? "0",
              )}{" "}
              /{" "}
              {formatTomanFromRialString(
                impact.maximumGrossProfitRial ?? "0",
              )}
            </p>
            <p>
              پلن‌های Dominated: فعلی{" "}
              {(impact.dominatedPlanCountCurrent ?? 0).toLocaleString("fa-IR")}{" "}
              → جدید{" "}
              {(impact.dominatedPlanCountNew ?? 0).toLocaleString("fa-IR")}
              {impact.newlyDominatedPlanCount
                ? ` · ${impact.newlyDominatedPlanCount.toLocaleString("fa-IR")} تازه غالب‌شده`
                : ""}
            </p>
            {impact.monotonicity ? (
              impact.monotonicity.ok ? (
                <p className="pricing-save-ok">
                  یکنواختی قیمت فروش تأیید شد (
                  {impact.monotonicity.sampled.toLocaleString("fa-IR")} نقطه).
                </p>
              ) : (
                <div>
                  <p className="pricing-save-err">
                    شکست یکنواختی — انتشار مسدود می‌شود.
                  </p>
                  <ul className="finance-impact-list">
                    {impact.monotonicity.failures.slice(0, 5).map((issue) => (
                      <li key={issue.code + issue.message}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )
            ) : null}
            {(impact.topAffected ?? []).length > 0 ? (
              <ul className="finance-impact-list">
                {(impact.topAffected ?? []).slice(0, 10).map((row) => (
                  <li key={row.planId}>
                    {row.title}:{" "}
                    {formatTomanFromRialString(row.currentFinalRial ?? "0")} ←{" "}
                    {formatTomanFromRialString(row.candidateFinalRial ?? "0")}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="product-muted" style={{ marginTop: 10 }}>
            قبل از انتشار، اثر روی پلن‌های عمومی را ببین.
          </p>
        )}
      </SectionCard>
    </section>
  );
}

export function profitCurveDraftFromConfig(config: {
  enabled?: boolean;
  minimumPostDiscountGrossMarginBps?: number;
  bands?: Array<{
    id?: string;
    sortOrder?: number;
    minProviderCostRial: string;
    maxProviderCostRial: string | null;
    targetGrossMarginBps: number;
  }>;
  activeRevisionId?: string | null;
  updatedAt?: string | null;
}): {
  enabled: boolean;
  floorPercent: string;
  bands: ProfitCurveBandDraft[];
  activeRevisionId: string | null;
  updatedAt: string | null;
} {
  const bandsSource =
    config.bands && config.bands.length === 5
      ? config.bands
      : [
          {
            id: "band-0-5m",
            sortOrder: 0,
            minProviderCostRial: "0",
            maxProviderCostRial: String(5_000_000n * 10n),
            targetGrossMarginBps: 7_000,
          },
          {
            id: "band-5-10m",
            sortOrder: 1,
            minProviderCostRial: String(5_000_000n * 10n),
            maxProviderCostRial: String(10_000_000n * 10n),
            targetGrossMarginBps: 6_000,
          },
          {
            id: "band-10-15m",
            sortOrder: 2,
            minProviderCostRial: String(10_000_000n * 10n),
            maxProviderCostRial: String(15_000_000n * 10n),
            targetGrossMarginBps: 5_000,
          },
          {
            id: "band-15-25m",
            sortOrder: 3,
            minProviderCostRial: String(15_000_000n * 10n),
            maxProviderCostRial: String(25_000_000n * 10n),
            targetGrossMarginBps: 4_000,
          },
          {
            id: "band-25m-plus",
            sortOrder: 4,
            minProviderCostRial: String(25_000_000n * 10n),
            maxProviderCostRial: null,
            targetGrossMarginBps: 3_000,
          },
        ];

  return {
    enabled: config.enabled !== false,
    floorPercent: bpsToPercent(
      config.minimumPostDiscountGrossMarginBps ?? 2_000,
    ),
    bands: bandsSource
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((band, index) => ({
        id: band.id ?? `band-${index}`,
        sortOrder: band.sortOrder ?? index,
        minCostToman: (BigInt(band.minProviderCostRial) / 10n).toString(),
        maxCostToman:
          band.maxProviderCostRial == null
            ? ""
            : (BigInt(band.maxProviderCostRial) / 10n).toString(),
        marginPercent: bpsToPercent(band.targetGrossMarginBps),
      })),
    activeRevisionId: config.activeRevisionId ?? null,
    updatedAt: config.updatedAt ?? null,
  };
}

export function serializeProfitCurveCandidate(
  enabled: boolean,
  floorPercent: string,
  bands: ProfitCurveBandDraft[],
) {
  const floor = percentToBps(floorPercent);
  const parsed = draftsToBands(bands);
  if (floor == null || !parsed) return null;
  return {
    enabled,
    minimumPostDiscountGrossMarginBps: floor,
    bands: parsed.map((band) => ({
      id: band.id,
      sortOrder: band.sortOrder,
      minProviderCostRial: band.minProviderCostRial.toString(),
      maxProviderCostRial:
        band.maxProviderCostRial == null
          ? null
          : band.maxProviderCostRial.toString(),
      targetGrossMarginBps: band.targetGrossMarginBps,
    })),
  };
}
