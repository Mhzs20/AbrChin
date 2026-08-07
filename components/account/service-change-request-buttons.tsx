"use client";

import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog } from "@/components/product/confirm-dialog";

export function ServiceChangeRequestButtons({
  instanceId,
  orderId,
  serverName,
  currentResources,
}: {
  instanceId: string;
  orderId?: string;
  serverName: string;
  currentResources?: {
    vcpu?: number | null;
    ramGb?: number | null;
    diskGb?: number | null;
  } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitUpgrade() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/account/resource-changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instanceId, action: "UPGRADE" }),
      });
      const payload = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) {
        throw new Error(payload.error || "ثبت درخواست ممکن نشد.");
      }
      setMessage(
        "درخواست ارتقا ثبت شد. قیمت نهایی قبل از هر شارژ جداگانه تأیید می‌شود.",
      );
      setConfirm(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "ثبت درخواست ممکن نشد.",
      );
    } finally {
      setBusy(false);
    }
  }

  const resourcesLabel =
    currentResources &&
    (currentResources.vcpu || currentResources.ramGb || currentResources.diskGb)
      ? [
          currentResources.vcpu != null ? `${currentResources.vcpu} vCPU` : null,
          currentResources.ramGb != null ? `${currentResources.ramGb} GB RAM` : null,
          currentResources.diskGb != null
            ? `${currentResources.diskGb} GB Disk`
            : null,
        ]
          .filter(Boolean)
          .join(" / ")
      : null;

  return (
    <span style={{ display: "grid", gap: 4 }}>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          style={{ minHeight: 44 }}
          disabled={busy}
          aria-label={`درخواست ارتقا برای ${serverName}`}
          onClick={() => setConfirm(true)}
        >
          {busy ? "…" : "درخواست ارتقا"}
        </button>
        {orderId ? (
          <Link
            className="product-btn product-btn--quiet"
            style={{ minHeight: 44 }}
            href={`/account/orders/${orderId}#cancel-service`}
          >
            لغو سرویس
          </Link>
        ) : null}
      </span>
      {message ? (
        <small style={{ color: "var(--product-success, green)" }}>{message}</small>
      ) : null}
      {error ? <small style={{ color: "crimson" }}>{error}</small> : null}

      <ConfirmDialog
        open={confirm}
        title="تأیید درخواست تغییر منابع"
        loading={busy}
        confirmLabel="ثبت درخواست ارتقا"
        cancelLabel="انصراف"
        onCancel={() => setConfirm(false)}
        onConfirm={() => void submitUpgrade()}
      >
        <p>
          سرور: <strong dir="ltr">{serverName}</strong>
        </p>
        {resourcesLabel ? (
          <p>
            منابع فعلی: <strong dir="ltr">{resourcesLabel}</strong>
          </p>
        ) : null}
        <p>
          این فقط یک <strong>درخواست</strong> است. منابع مقصد و مبلغ نهایی قبل از
          هر شارژ جداگانه تأیید می‌شوند و تغییر رایگان فرض نمی‌شود.
        </p>
      </ConfirmDialog>
    </span>
  );
}
