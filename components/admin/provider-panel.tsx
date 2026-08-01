"use client";

import { useState } from "react";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/product";

export function ProviderPanel({
  provider,
  title,
  initial,
  catalogItems,
  syncRuns,
}: {
  provider: "ARVAN" | "PARSPACK";
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
    provider: "ARVAN" | "PARSPACK";
    apiVersion: string;
    source:
      | "API_CATALOG"
      | "MANUAL_API_BACKED"
      | "PREPROVISIONED_INVENTORY";
    status: string;
    regionCode: string;
    sizeCode: string;
    vcpu: number | null;
    ramMb: number | null;
    diskGb: number | null;
    available: boolean;
    priced: boolean;
    basePriceRial: string | null;
    finalPriceRial: string | null;
    lastSyncedAt: string;
    manualAvailableUnits: number | null;
    manualPriceValidUntil: string | null;
  }>;
  syncRuns: Array<{
    id: string;
    provider: "ARVAN" | "PARSPACK";
    apiVersion: string;
    status: string;
    catalogVersion: string;
    regionCount: number;
    successfulRegions: number;
    failedRegions: number;
    planCount: number;
    imageCount: number;
    durationMs: number | null;
    report: unknown;
    startedAt: string;
    finishedAt: string | null;
  }>;
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState<"health" | "sync" | null>(null);
  const [error, setError] = useState("");
  const [markupPercent, setMarkupPercent] = useState(
    String(initial.markupBasisPoints / 100),
  );
  const [providerEnabled, setProviderEnabled] = useState(initial.enabled);

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
      setState(data.state);
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(null);
    }
  }

  async function saveMarkup() {
    setLoading("sync");
    setError("");
    try {
      const response = await fetch("/api/admin/infrastructure/providers/markup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          markupPercent,
          enabled: providerEnabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "ذخیره Markup ناموفق بود.");
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        description={`API ${initial.apiVersion} · همگام‌سازی کاتالوگ منطقه‌ای`}
      />
      <div className="product-stat-grid">
        <StatCard label="وضعیت" value={<StatusBadge label={state.message} tone={state.status === "healthy" ? "success" : "warning"} />} />
        <StatCard label="Secret" value={state.configured ? "تنظیم شده" : "تنظیم نشده"} />
        <StatCard label="API Version" value={state.apiVersion} />
        <StatCard label="Region" value={state.regionCount.toLocaleString("fa-IR")} />
        <StatCard label="Size" value={state.sizeCount.toLocaleString("fa-IR")} />
        <StatCard label="Image" value={state.imageCount.toLocaleString("fa-IR")} />
        <StatCard label="Catalog Item" value={state.catalogItemCount.toLocaleString("fa-IR")} />
        <StatCard label="قیمت‌دار" value={state.pricedItemCount.toLocaleString("fa-IR")} />
        <StatCard label="ناموجود" value={state.unavailableItemCount.toLocaleString("fa-IR")} />
        <StatCard label="Stale" value={state.staleItemCount.toLocaleString("fa-IR")} />
        <StatCard label="قیمت نامعتبر" value={state.invalidPriceCount.toLocaleString("fa-IR")} />
        <StatCard label="منابع نامعتبر" value={state.invalidResourceCount.toLocaleString("fa-IR")} />
        <StatCard label="Network" value={state.networkCount.toLocaleString("fa-IR")} />
        <StatCard label="Security" value={state.securityCount.toLocaleString("fa-IR")} />
        <StatCard
          label="آخرین Sync"
          value={
            state.lastCatalogSync
              ? new Date(state.lastCatalogSync).toLocaleString("fa-IR")
              : "—"
          }
        />
        <StatCard
          label="مدت Sync"
          value={
            state.syncDurationMs == null
              ? "—"
              : `${state.syncDurationMs.toLocaleString("fa-IR")} ms`
          }
        />
        <StatCard label="نتیجه Sync" value={state.lastSyncStatus ?? "—"} />
        <StatCard
          label="Request ID"
          value={state.lastProviderRequestId ?? "—"}
        />
      </div>
      <SectionCard title="عملیات">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="product-btn product-btn--primary" disabled={loading !== null} onClick={() => run("health")}>
            بررسی اتصال
          </button>
          <button type="button" className="product-btn product-btn--quiet" disabled={loading !== null} onClick={() => run("sync")}>
            Sync Catalog
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
      <SectionCard title="Markup سراسری">
        <p>
          قیمت پایه Read-only است. واحد منبع: {state.sourceMoneyUnit ?? "تأیید نشده"}.
          مالیات و پرچین Line Item مستقل هستند.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            <input
              checked={providerEnabled}
              onChange={(event) => setProviderEnabled(event.target.checked)}
              type="checkbox"
            />
            Provider برای فروش فعال باشد
          </label>
          <label>
            درصد Markup
            <input
              type="text"
              inputMode="decimal"
              value={markupPercent}
              onChange={(event) => setMarkupPercent(event.target.value)}
              style={{ display: "block", marginTop: 6, maxWidth: 180 }}
            />
          </label>
          <button
            type="button"
            className="product-btn product-btn--primary"
            disabled={loading !== null}
            onClick={saveMarkup}
          >
            ذخیره Markup
          </button>
        </div>
      </SectionCard>
      <SectionCard title="کاتالوگ قیمت">
        <p>
          قیمت نهایی شامل Markup ارائه‌دهنده، Markup نوع محصول، پرچین شروع و
          مالیات فعلی است.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="product-table">
            <thead>
              <tr>
                <th>Region / Size</th>
                <th>منابع</th>
                <th>قیمت پایه</th>
                <th>قیمت نهایی</th>
                <th>وضعیت</th>
                <th>آخرین Sync</th>
              </tr>
            </thead>
            <tbody>
              {catalogItems
                .filter((item) => item.provider === provider)
                .map((item) => (
                <tr key={item.id}>
                  <td className="product-tech">
                    {item.regionCode} / {item.sizeCode}
                    <br />
                    <small>
                      {item.source === "MANUAL_API_BACKED"
                        ? "Manual API-backed"
                        : item.source === "PREPROVISIONED_INVENTORY"
                          ? "Preprovisioned inventory"
                          : "API catalog"}
                    </small>
                  </td>
                  <td>{item.vcpu ?? "—"} vCPU · {item.ramMb ?? "—"} MB · {item.diskGb ?? "—"} GB</td>
                  <td>{item.basePriceRial ? `${(BigInt(item.basePriceRial) / 10n).toLocaleString("fa-IR")} تومان` : "تأیید نشده"}</td>
                  <td>{item.finalPriceRial ? `${(BigInt(item.finalPriceRial) / 10n).toLocaleString("fa-IR")} تومان` : "—"}</td>
                  <td>{item.status === "ACTIVE" && item.available && item.priced ? "قابل فروش" : item.status}</td>
                  <td>{new Date(item.lastSyncedAt).toLocaleString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SectionCard title="گزارش آخرین Syncها">
        <div style={{ overflowX: "auto" }}>
          <table className="product-table">
            <thead>
              <tr>
                <th>شروع</th>
                <th>نتیجه</th>
                <th>Region</th>
                <th>Plan / Image</th>
                <th>مدت</th>
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
                      {run.imageCount.toLocaleString("fa-IR")}
                    </td>
                    <td>
                      {run.durationMs == null
                        ? "—"
                        : `${run.durationMs.toLocaleString("fa-IR")} ms`}
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
