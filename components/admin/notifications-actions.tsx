"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkAllNotificationsRead({ unread }: { unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unread === 0) return null;

  async function markAll() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/notifications/mark-all-read", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
    } catch {
      setError("علامت‌گذاری انجام نشد؛ دوباره تلاش کن.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        className="product-btn product-btn--quiet"
        disabled={busy}
        onClick={() => void markAll()}
      >
        {busy
          ? "در حال علامت‌گذاری…"
          : `همه را خواندم (${unread.toLocaleString("fa-IR")})`}
      </button>
      {error ? <span className="product-error">{error}</span> : null}
    </div>
  );
}
