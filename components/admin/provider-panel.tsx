"use client";

import { useState } from "react";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/product";

export function ProviderPanel({
  initial,
}: {
  initial: {
    status: string;
    message: string;
    lastHealthCheck: string | null;
    lastCatalogSync: string | null;
    regionCount: number;
    sizeCount: number;
    imageCount: number;
    lastError: string | null;
    configured: boolean;
  };
}) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState<"health" | "sync" | null>(null);
  const [error, setError] = useState("");

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

  return (
    <>
      <PageHeader title="تأمین‌کننده‌ها" description="وضعیت ParsPack و همگام‌سازی کاتالوگ" />
      <div className="product-stat-grid">
        <StatCard label="وضعیت" value={<StatusBadge label={state.message} tone={state.status === "healthy" ? "success" : "warning"} />} />
        <StatCard label="Token" value={state.configured ? "تنظیم شده" : "تنظیم نشده"} />
        <StatCard label="Region" value={state.regionCount.toLocaleString("fa-IR")} />
        <StatCard label="Size" value={state.sizeCount.toLocaleString("fa-IR")} />
        <StatCard label="Image" value={state.imageCount.toLocaleString("fa-IR")} />
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
    </>
  );
}
