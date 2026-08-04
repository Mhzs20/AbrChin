"use client";

import { useState } from "react";

export function ServiceChangeRequestButtons({
  instanceId,
}: {
  instanceId: string;
}) {
  const [busy, setBusy] = useState<"UPGRADE" | "TERMINATE" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "UPGRADE" | "TERMINATE") {
    setBusy(action);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/account/resource-changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instanceId, action }),
      });
      const payload = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) {
        throw new Error(payload.error || "ثبت درخواست ممکن نشد.");
      }
      setMessage(
        action === "UPGRADE"
          ? "درخواست ارتقا ثبت شد و منتظر بررسی ابرچین است."
          : "درخواست حذف ثبت شد و منتظر بررسی ابرچین است.",
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "ثبت درخواست ممکن نشد.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          disabled={busy != null}
          onClick={() => void submit("UPGRADE")}
        >
          {busy === "UPGRADE" ? "…" : "درخواست ارتقا"}
        </button>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          disabled={busy != null}
          onClick={() => void submit("TERMINATE")}
        >
          {busy === "TERMINATE" ? "…" : "درخواست حذف"}
        </button>
      </span>
      {message ? (
        <small style={{ color: "var(--product-success, green)" }}>{message}</small>
      ) : null}
      {error ? <small style={{ color: "crimson" }}>{error}</small> : null}
    </span>
  );
}
