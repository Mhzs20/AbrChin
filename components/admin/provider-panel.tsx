"use client";

import Link from "next/link";
import { useState } from "react";

import {
  PageHeader,
  SectionCard,
  StatCard,
  StatusBadge,
} from "@/components/product";

function formatRialAsToman(value: string | null): string {
  if (!value) return "در دسترس نیست";
  const rial = BigInt(value);
  const toman = rial / 10n;
  const remainder = rial % 10n;
  const amount =
    remainder === 0n
      ? toman.toLocaleString("fa-IR")
      : `${toman.toLocaleString("fa-IR")}٫${remainder.toLocaleString("fa-IR")}`;
  return `${amount} تومان`;
}

function SalePrice({ value, suffix }: { value: string | null; suffix?: string }) {
  if (!value) return <span>—</span>;
  return (
    <span className="money-tone money-tone--sale">
      <span className="money-tone-label">فروش</span>
      {formatRialAsToman(value)}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function CostPrice({ value, suffix }: { value: string | null; suffix?: string }) {
  if (!value) return <span>—</span>;
  return (
    <span className="money-tone money-tone--cost">
      <span className="money-tone-label">خرید</span>
      {formatRialAsToman(value)}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function formatBasisPoints(value: number | null): string {
  if (value == null) return "—";
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return fraction === 0
    ? `${whole.toLocaleString("fa-IR")}٪`
    : `${whole.toLocaleString("fa-IR")}٫${String(fraction)
        .padStart(2, "0")
        .replace(/0$/, "")}٪`;
}

function catalogStateLabel(item: {
  status: string;
  available: boolean;
  priced: boolean;
}) {
  if (item.status === "INVALID_RESOURCE") return "منابع نامعتبر";
  if (item.status === "STALE") return "Stale";
  if (item.status === "UNAVAILABLE" || !item.available) return "ناموجود";
  if (item.status === "DISABLED") return "غیرفعال";
  if (item.status === "INVALID_PRICE" || !item.priced) {
    return "قیمت در دسترس نیست";
  }
  return "Sync فعال و قیمت‌دار";
}

export function ProviderPanel({
  provider,
  providerLabel,
  title,
  initial,
  catalogItems,
  syncRuns,
  dailyStats,
}: {
  provider: "ARVAN";
  providerLabel: "Arvan";
  title: string;
  initial: {
    status: string;
    message: string;
    lastHealthCheck: string | null;
    lastCatalogSync: string | null;
    regionCount: number;
    sizeCount: number;
    imageCount: number;
    catalogItemCount: number;
    pricedItemCount: number;
    unavailableItemCount: number;
    staleItemCount: number;
    invalidPriceCount: number;
    invalidResourceCount: number;
    networkCount: number;
    securityCount: number;
    apiVersion: string;
    enabled: boolean;
    syncDurationMs: number | null;
    lastSyncStatus: string | null;
    regionErrors: unknown;
    sourceMoneyUnit: string | null;
    lastProviderRequestId: string | null;
    markupBasisPoints: number;
    lastError: string | null;
    configured: boolean;
  };
  catalogItems: Array<{
    id: string;
    provider: "ARVAN";
    apiVersion: string;
    productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
    source:
      | "API_CATALOG"
      | "MANUAL_API_BACKED"
      | "PREPROVISIONED_INVENTORY"
      | "MANUAL_ADMIN";
    status: string;
    regionCode: string;
    sizeCode: string;
    vcpu: number | null;
    ramMb: number | null;
    diskGb: number | null;
    available: boolean;
    priced: boolean;
    baseHourlyPriceRial: string | null;
    basePriceRial: string | null;
    finalPriceRial: string | null;
    currencyCode: string | null;
    amountUnit: string | null;
    billingIntervals: string[];
    providerMarkupBasisPoints: number | null;
    productMarkupBasisPoints: number | null;
    taxBasisPoints: number | null;
    publishedSkuCount: number;
    lastSyncedAt: string;
    manualAvailableUnits: number | null;
    manualPriceValidUntil: string | null;
  }>;
  syncRuns: Array<{
    id: string;
    provider: "ARVAN";
    apiVersion: string;
    status: string;
    catalogVersion: string;
    regionCount: number;
    successfulRegions: number;
    failedRegions: number;
    planCount: number;
    imageCount: number;
    networkCount: number;
    securityCount: number;
    durationMs: number | null;
    report: unknown;
    startedAt: string;
    finishedAt: string | null;
  }>;
  dailyStats: {
    syncRunsToday: number;
    plansSyncedToday: number;
  };
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState<"health" | "sync" | null>(null);
  const [error, setError] = useState("");

  async function run(action: "health" | "sync") {
    setLoading(action);
    setError("");
    try {
      const response = await fetch(`/api/admin/infrastructure/providers/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "عملیات ناموفق بود.");
        return;
      }
      if (action === "sync") {
        window.location.reload();
        return;
      }
      setState(data.state);
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(null);
    }
  }

  const providerItems = catalogItems.filter((item) => item.provider === provider);
  const syncedTodayItems = providerItems.filter((item) => {
    const synced = new Date(item.lastSyncedAt);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return synced.getTime() >= start.getTime();
  }).length;

  return (
    <>
      <PageHeader
        title={title}
        description={`${providerLabel} · API ${initial.apiVersion} · همگام‌سازی کاتالوگ منطقه‌ای`}
      />
      <div className="product-stat-grid">
        <StatCard
          label="تأمین‌کننده"
          value={
            <span className="provider-code-badge" data-code={provider}>
              {providerLabel}
            </span>
          }
        />
        <StatCard label="وضعیت" value={<StatusBadge label={state.message} tone={state.status === "healthy" ? "success" : "warning"} />} />
        <StatCard label="Secret" value={state.configured ? "تنظیم شده" : "تنظیم نشده"} />
        <StatCard
          label="سرورهای دریافتی امروز"
          value={Math.max(
            dailyStats.plansSyncedToday,
            syncedTodayItems,
          ).toLocaleString("fa-IR")}
        />
        <StatCard
          label="Syncهای امروز"
          value={dailyStats.syncRunsToday.toLocaleString("fa-IR")}
        />
        <StatCard label="Catalog Item" value={state.catalogItemCount.toLocaleString("fa-IR")} />
        <StatCard label="قیمت‌دار" value={state.pricedItemCount.toLocaleString("fa-IR")} />
        <StatCard label="Region" value={state.regionCount.toLocaleString("fa-IR")} />
        <StatCard
          label="آخرین Sync"
          value={
            state.lastCatalogSync
              ? new Date(state.lastCatalogSync).toLocaleString("fa-IR")
              : "—"
          }
        />
        <StatCard label="نتیجه Sync" value={state.lastSyncStatus ?? "—"} />
      </div>
      <details className="admin-advanced-stats">
        <summary>آمار پیشرفته Sync</summary>
        <div className="product-stat-grid" style={{ marginTop: 12 }}>
          <StatCard label="API Version" value={state.apiVersion} />
          <StatCard label="Size" value={state.sizeCount.toLocaleString("fa-IR")} />
          <StatCard label="Image" value={state.imageCount.toLocaleString("fa-IR")} />
          <StatCard label="ناموجود" value={state.unavailableItemCount.toLocaleString("fa-IR")} />
          <StatCard label="Stale" value={state.staleItemCount.toLocaleString("fa-IR")} />
          <StatCard label="قیمت نامعتبر" value={state.invalidPriceCount.toLocaleString("fa-IR")} />
          <StatCard label="منابع نامعتبر" value={state.invalidResourceCount.toLocaleString("fa-IR")} />
          <StatCard label="Network" value={state.networkCount.toLocaleString("fa-IR")} />
          <StatCard label="Security" value={state.securityCount.toLocaleString("fa-IR")} />
          <StatCard
            label="مدت Sync"
            value={
              state.syncDurationMs == null
                ? "—"
                : `${state.syncDurationMs.toLocaleString("fa-IR")} ms`
            }
          />
          <StatCard
            label="Request ID"
            value={state.lastProviderRequestId ?? "—"}
          />
        </div>
      </details>
      <SectionCard title="اقدام بعدی">
        <p>
          اول اتصال را چک کن، بعد کاتالوگ را به‌روز کن. Sync فقط لیست قیمت/ظرفیت
          را می‌خواند و به‌تنهایی چیزی را برای مشتری منتشر نمی‌کند.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="product-btn product-btn--primary" disabled={loading !== null} onClick={() => run("health")}>
            ۱. بررسی اتصال
          </button>
          <button type="button" className="product-btn product-btn--quiet" disabled={loading !== null || !state.configured} onClick={() => run("sync")}>
            ۲. به‌روزرسانی کاتالوگ
          </button>
        </div>
        {state.lastError ? <p style={{ color: "#a83224", marginTop: 12 }}>{state.lastError}</p> : null}
        {Array.isArray(state.regionErrors) && state.regionErrors.length > 0 ? (
          <details style={{ marginTop: 12 }}>
            <summary>خطاهای Sanitized هر Region</summary>
            <pre>{JSON.stringify(state.regionErrors, null, 2)}</pre>
          </details>
        ) : null}
        {error ? <p className="product-error">{error}</p> : null}
      </SectionCard>
      <SectionCard title="Markup و قیمت‌گذاری">
        <p>
          تعیین سود {providerLabel}، پرچین، مالیات و کد تخفیف فقط در{" "}
          <strong>مرکز مالی</strong> انجام می‌شود تا با Sync کاتالوگ قاطی نشود.
          قیمت خرید اینجا Read-only است (واحد منبع:{" "}
          {state.sourceMoneyUnit ?? "تأیید نشده"}).
        </p>
        <p style={{ marginTop: 8 }}>
          Markup فعلی این منبع:{" "}
          <strong className="money-tone money-tone--sale">
            {(initial.markupBasisPoints / 100).toLocaleString("fa-IR")}٪
          </strong>
          {" · "}
          {initial.enabled ? "فعال" : "خاموش"}
        </p>
        <div style={{ marginTop: 12 }}>
          <Link href="/admin/finance#finance-markup" className="product-btn product-btn--primary">
            تنظیم در مرکز مالی
          </Link>
        </div>
      </SectionCard>
      <div id="catalog">
      <SectionCard title="کاتالوگ قیمت">
        <p>
          قیمت نهایی شامل Markup ارائه‌دهنده، Markup نوع محصول، پرچین شروع و
          مالیات فعلی است. «Sync فعال» به معنی منتشر یا قابل‌خریدبودن SKU
          نیست.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="product-table">
            <thead>
              <tr>
                <th>Region / Size</th>
                <th>منابع</th>
                  <th>قیمت خرید</th>
                  <th>قیمت فروش</th>
                  <th>قرارداد قیمت</th>
                  <th>Availability / انتشار</th>
                  <th>آخرین Sync</th>
                </tr>
              </thead>
              <tbody>
              {providerItems.map((item) => (
                <tr key={item.id}>
                  <td className="product-tech">
                    <span className="provider-code-badge" data-code={provider}>
                      {providerLabel}
                    </span>{" "}
                    {item.regionCode} / {item.sizeCode}
                    <br />
                    <small>
                      {item.source === "MANUAL_API_BACKED"
                        ? "Manual API-backed"
                        : item.source === "MANUAL_ADMIN"
                          ? "Manual Admin"
                        : item.source === "PREPROVISIONED_INVENTORY"
                          ? "Preprovisioned inventory"
                          : "API catalog"}
                    </small>
                  </td>
                  <td>{item.vcpu ?? "—"} vCPU · {item.ramMb ?? "—"} MB · {item.diskGb ?? "—"} GB</td>
                  <td>
                    {item.baseHourlyPriceRial ? (
                      <>
                        <CostPrice value={item.baseHourlyPriceRial} suffix="/ ساعت" />
                        <br />
                      </>
                    ) : null}
                    <CostPrice value={item.basePriceRial} suffix="/ ماه" />
                  </td>
                  <td>
                    {item.finalPriceRial && item.basePriceRial ? (
                      <>
                        <SalePrice value={item.finalPriceRial} suffix="/ ماه" />
                        <br />
                        <small>
                          سود تقریبی:{" "}
                          {formatRialAsToman(
                            (
                              BigInt(item.finalPriceRial) - BigInt(item.basePriceRial)
                            ).toString(),
                          )}{" "}
                          / ماه
                        </small>
                      </>
                    ) : item.productKind === "CLOUD_SERVER" ? (
                      "در Estimate نسخه‌دار SKU محاسبه می‌شود"
                    ) : (
                      "قیمت نهایی پس از فعال‌سازی Markup"
                    )}
                    <br />
                    <small>
                      Markup Provider{" "}
                      {formatBasisPoints(item.providerMarkupBasisPoints)} ·
                      Product{" "}
                      {formatBasisPoints(item.productMarkupBasisPoints)} · مالیات{" "}
                      {formatBasisPoints(item.taxBasisPoints)}
                    </small>
                  </td>
                  <td className="product-tech">
                    {item.currencyCode ?? "UNKNOWN"} /{" "}
                    {item.amountUnit ?? "UNKNOWN"}
                    <br />
                    <small>
                      {item.billingIntervals.length > 0
                        ? item.billingIntervals.join(" + ")
                        : "PRICE UNAVAILABLE"}
                    </small>
                  </td>
                  <td>
                    {catalogStateLabel(item)}
                    <br />
                    <small>
                      {item.publishedSkuCount.toLocaleString("fa-IR")} SKU
                      منتشرشده
                    </small>
                  </td>
                  <td>{new Date(item.lastSyncedAt).toLocaleString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      </div>
      <SectionCard title="گزارش آخرین Syncها">
        <div style={{ overflowX: "auto" }}>
          <table className="product-table">
            <thead>
              <tr>
                <th>شروع</th>
                <th>نتیجه</th>
                <th>Region</th>
                <th>Plan / Image / Network / Security</th>
                <th>مدت</th>
                <th>پایان</th>
                <th>گزارش Sanitized</th>
              </tr>
            </thead>
            <tbody>
              {syncRuns
                .filter((run) => run.provider === provider)
                .map((run) => (
                  <tr key={run.id}>
                    <td>{new Date(run.startedAt).toLocaleString("fa-IR")}</td>
                    <td>{run.status}</td>
                    <td>
                      {run.successfulRegions.toLocaleString("fa-IR")} موفق ·{" "}
                      {run.failedRegions.toLocaleString("fa-IR")} ناموفق
                    </td>
                    <td>
                      {run.planCount.toLocaleString("fa-IR")} /{" "}
                      {run.imageCount.toLocaleString("fa-IR")} /{" "}
                      {run.networkCount.toLocaleString("fa-IR")} /{" "}
                      {run.securityCount.toLocaleString("fa-IR")}
                    </td>
                    <td>
                      {run.durationMs == null
                        ? "—"
                        : `${run.durationMs.toLocaleString("fa-IR")} ms`}
                    </td>
                    <td>
                      {run.finishedAt
                        ? new Date(run.finishedAt).toLocaleString("fa-IR")
                        : "در حال اجرا"}
                    </td>
                    <td>
                      {run.report ? (
                        <details>
                          <summary>مشاهده</summary>
                          <pre>{JSON.stringify(run.report, null, 2)}</pre>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
