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

type DiscoverySummary = {
  discoveredCount: number;
  created: number;
  refreshed: number;
  unchanged: number;
};

function sourceLabel(source: string) {
  if (source === "ENV_BOOTSTRAP") return "Bootstrap Env";
  if (source === "PROVIDER_DISCOVERY") return "سرویس‌دهنده";
  return "Admin";
}

export function ProviderRegionsPanel({
  initialRegions,
  initialDiscovery = null,
  initialDiscoveryError = null,
}: {
  initialRegions: RegionRow[];
  initialDiscovery?: DiscoverySummary | null;
  initialDiscoveryError?: string | null;
}) {
  const [regions, setRegions] = useState(initialRegions);
  const [regionCode, setRegionCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialDiscoveryError ?? "");
  const [message, setMessage] = useState(
    initialDiscovery
      ? `از سرویس‌دهنده ${initialDiscovery.discoveredCount.toLocaleString("fa-IR")} منطقه خوانده شد؛ ${initialDiscovery.created.toLocaleString("fa-IR")} مورد جدید با Sync و فروش فعال اضافه شد.`
      : "",
  );

  async function discoverFromProvider() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/infrastructure/providers/regions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action: "discover_from_provider" }),
      });
      const data = (await response.json()) as {
        error?: string;
        regions?: RegionRow[];
        discovery?: DiscoverySummary;
      };
      if (!response.ok) throw new Error(data.error ?? "دریافت Region ممکن نیست.");
      if (data.regions) setRegions(data.regions);
      if (data.discovery) {
        setMessage(
          `از سرویس‌دهنده ${data.discovery.discoveredCount.toLocaleString("fa-IR")} منطقه خوانده شد؛ ${data.discovery.created.toLocaleString("fa-IR")} مورد جدید فعال شد. غیرفعال‌های شما دست نخورده ماند.`,
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "دریافت Region از سرویس‌دهنده ممکن نیست.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function addRegion() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/infrastructure/providers/regions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          regionCode,
          displayName,
          syncEnabled: true,
          saleEnabled: true,
        }),
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
      setRegions((current) =>
        current.map((item) =>
          item.id === region.id ? { ...item, ...data.region } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Region تغییر نکرد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="Regionهای آروان — همگام با سرویس‌دهنده">
      <p>
        مناطق از API خواندنی سرویس‌دهنده (AV) به‌صورت خودکار پر می‌شوند و به‌طور
        پیش‌فرض Sync و فروش‌شان فعال است. فقط وقتی شما غیرفعال کنید خاموش
        می‌مانند. Catalog Sync هم همین کشف را قبل از Sync انجام می‌دهد.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="product-btn product-btn--primary"
          disabled={loading}
          onClick={() => void discoverFromProvider()}
        >
          دریافت مناطق از سرویس‌دهنده
        </button>
      </div>
      {message ? <p className="product-muted">{message}</p> : null}

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}>افزودن دستی (اختیاری)</summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(180px,1fr) minmax(220px,2fr) auto",
            gap: 8,
            alignItems: "end",
            marginTop: 12,
          }}
        >
          <FormField id="provider-region-code" label="Region Code">
            <input
              id="provider-region-code"
              value={regionCode}
              onChange={(event) => setRegionCode(event.target.value)}
              placeholder="ir-thr-si1"
            />
          </FormField>
          <FormField id="provider-region-name" label="نام نمایشی">
            <input
              id="provider-region-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="سیمین، غرب تهران"
            />
          </FormField>
          <button
            type="button"
            className="product-btn product-btn--quiet"
            disabled={loading || !regionCode || !displayName}
            onClick={() => void addRegion()}
          >
            اعتبارسنجی و افزودن
          </button>
        </div>
      </details>

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table className="product-table">
          <thead>
            <tr>
              <th>Region</th>
              <th>منبع</th>
              <th>Validation</th>
              <th>Sync</th>
              <th>فروش</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region.id}>
                <td>
                  {region.displayName}
                  <br />
                  <span className="product-tech">{region.regionCode}</span>
                </td>
                <td>{sourceLabel(region.source)}</td>
                <td>{region.lastValidationCode ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    disabled={loading}
                    onClick={() => void toggle(region, "syncEnabled")}
                  >
                    {region.syncEnabled ? "فعال" : "غیرفعال"}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    disabled={loading}
                    onClick={() => void toggle(region, "saleEnabled")}
                  >
                    {region.saleEnabled ? "نمایش" : "پنهان"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="product-error">{error}</p> : null}
    </SectionCard>
  );
}
