"use client";

import { useState } from "react";

import { FormField, SectionCard } from "@/components/product";

type RegionRow = {
  id: string;
  regionCode: string;
  displayName: string;
  source: string;
  syncEnabled: boolean;
  saleEnabled: boolean;
  sortOrder: number;
  lastValidatedAt: string | null;
  lastValidationCode: string | null;
};

export function ProviderRegionsPanel({ initialRegions }: { initialRegions: RegionRow[] }) {
  const [regions, setRegions] = useState(initialRegions);
  const [regionCode, setRegionCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function addRegion() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/infrastructure/providers/regions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ regionCode, displayName, syncEnabled: true, saleEnabled: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Region ذخیره نشد.");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Region ذخیره نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function toggle(region: RegionRow, field: "syncEnabled" | "saleEnabled") {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/infrastructure/providers/regions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ id: region.id, [field]: !region[field] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Region تغییر نکرد.");
      setRegions((current) => current.map((item) => item.id === region.id ? { ...item, ...data.region } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Region تغییر نکرد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Regionهای آروان — کنترل دیتابیسی">
      <p>
        مقدار Env فقط Bootstrap نصب اولیه است. پس از آن، Regionهای Sync و فروش از این جدول کنترل می‌شوند و افزودن Region تازه قبل از فعال‌شدن با GETهای خواندنی Provider اعتبارسنجی می‌شود.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(220px,2fr) auto", gap: 8, alignItems: "end" }}>
        <FormField id="provider-region-code" label="Region Code">
          <input id="provider-region-code" value={regionCode} onChange={(event) => setRegionCode(event.target.value)} placeholder="ir-thr-si1" />
        </FormField>
        <FormField id="provider-region-name" label="نام نمایشی">
          <input id="provider-region-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="سیمین، غرب تهران" />
        </FormField>
        <button type="button" className="product-btn product-btn--primary" disabled={loading || !regionCode || !displayName} onClick={addRegion}>اعتبارسنجی و افزودن</button>
      </div>
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table className="product-table">
          <thead><tr><th>Region</th><th>منبع</th><th>Validation</th><th>Sync</th><th>فروش</th></tr></thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.id}>
                <td>{region.displayName}<br /><span className="product-tech">{region.regionCode}</span></td>
                <td>{region.source === "ENV_BOOTSTRAP" ? "Bootstrap Env" : "Admin"}</td>
                <td>{region.lastValidationCode ?? "Bootstrap"}</td>
                <td><button type="button" className="product-btn product-btn--quiet" disabled={loading} onClick={() => toggle(region, "syncEnabled")}>{region.syncEnabled ? "فعال" : "غیرفعال"}</button></td>
                <td><button type="button" className="product-btn product-btn--quiet" disabled={loading} onClick={() => toggle(region, "saleEnabled")}>{region.saleEnabled ? "نمایش" : "پنهان"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="product-error">{error}</p> : null}
    </SectionCard>
  );
}
