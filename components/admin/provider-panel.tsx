"use client";

import { useState } from "react";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/product";

export function ProviderPanel({
  initial,
  catalogItems,
}: {
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
    markupBasisPoints: number;
    lastError: string | null;
    configured: boolean;
  };
  catalogItems: Array<{
    id: string;
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
  }>;
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState<"health" | "sync" | null>(null);
  const [error, setError] = useState("");
  const [markupPercent, setMarkupPercent] = useState(
    String(initial.markupBasisPoints / 100),
  );

  async function run(action: "health" | "sync") {
    setLoading(action);
    setError("");
    try {
      const response = await fetch(`/api/admin/infrastructure/providers/${action}`, { method: "POST" });
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
        body: JSON.stringify({ markupPercent }),
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
      <PageHeader title="تأمین‌کننده‌ها" description="وضعیت ParsPack و همگام‌سازی کاتالوگ" />
      <div className="product-stat-grid">
        <StatCard label="وضعیت" value={<StatusBadge label={state.message} tone={state.status === "healthy" ? "success" : "warning"} />} />
        <StatCard label="Token" value={state.configured ? "تنظیم شده" : "تنظیم نشده"} />
        <StatCard label="Region" value={state.regionCount.toLocaleString("fa-IR")} />
        <StatCard label="Size" value={state.sizeCount.toLocaleString("fa-IR")} />
        <StatCard label="Image" value={state.imageCount.toLocaleString("fa-IR")} />
        <StatCard label="Catalog Item" value={state.catalogItemCount.toLocaleString("fa-IR")} />
        <StatCard label="قیمت‌دار" value={state.pricedItemCount.toLocaleString("fa-IR")} />
        <StatCard label="ناموجود" value={state.unavailableItemCount.toLocaleString("fa-IR")} />
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
        {error ? <p className="product-error">{error}</p> : null}
      </SectionCard>
      <SectionCard title="Markup سراسری">
        <p>تنها تنظیم مالی قابل ویرایش است؛ قیمت پایه از کاتالوگ خوانده می‌شود.</p>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
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
              {catalogItems.map((item) => (
                <tr key={item.id}>
                  <td className="product-tech">{item.regionCode} / {item.sizeCode}</td>
                  <td>{item.vcpu ?? "—"} vCPU · {item.ramMb ?? "—"} MB · {item.diskGb ?? "—"} GB</td>
                  <td>{item.basePriceRial ? `${(BigInt(item.basePriceRial) / 10n).toLocaleString("fa-IR")} تومان` : "تأیید نشده"}</td>
                  <td>{item.finalPriceRial ? `${(BigInt(item.finalPriceRial) / 10n).toLocaleString("fa-IR")} تومان` : "—"}</td>
                  <td>{item.available && item.priced ? "قابل فروش" : item.available ? "بدون قرارداد قیمت" : "ناموجود"}</td>
                  <td>{new Date(item.lastSyncedAt).toLocaleString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}
