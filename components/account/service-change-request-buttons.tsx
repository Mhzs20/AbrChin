"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/product/confirm-dialog";

export function ServiceChangeRequestButtons({
  instanceId,
  serverName,
  currentResources,
}: {
  instanceId: string;
  serverName: string;
  currentResources?: {
    vcpu?: number | null;
    ramGb?: number | null;
    diskGb?: number | null;
  } | null;
}) {
  const [busy, setBusy] = useState<"UPGRADE" | "TERMINATE" | null>(null);
  const [confirm, setConfirm] = useState<"UPGRADE" | "TERMINATE" | null>(null);
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
          ? "درخواست ارتقا ثبت شد. قیمت نهایی قبل از هر شارژ جداگانه تأیید می‌شود."
          : "درخواست حذف ثبت شد و منتظر بررسی ابرچین است؛ حذف فوری انجام نمی‌شود.",
      );
      setConfirm(null);
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
          disabled={busy != null}
          aria-label={`درخواست ارتقا برای ${serverName}`}
          onClick={() => setConfirm("UPGRADE")}
        >
          {busy === "UPGRADE" ? "…" : "درخواست ارتقا"}
        </button>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          style={{ minHeight: 44 }}
          disabled={busy != null}
          aria-label={`درخواست حذف برای ${serverName}`}
          onClick={() => setConfirm("TERMINATE")}
        >
          {busy === "TERMINATE" ? "…" : "درخواست حذف"}
        </button>
      </span>
      {message ? (
        <small style={{ color: "var(--product-success, green)" }}>{message}</small>
      ) : null}
      {error ? <small style={{ color: "crimson" }}>{error}</small> : null}

      <ConfirmDialog
        open={confirm === "TERMINATE"}
        title="تأیید درخواست حذف سرور"
        danger
        loading={busy === "TERMINATE"}
        confirmLabel="ثبت درخواست حذف"
        cancelLabel="انصراف"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void submit("TERMINATE")}
      >
        <p>
          سرور: <strong dir="ltr">{serverName}</strong>
        </p>
        <p>
          این یک <strong>درخواست حذف</strong> است؛ با تأیید، سرور فوراً از بین
          نمی‌رود و منتظر بررسی ابرچین می‌ماند.
        </p>
        <p>
          قبل از حذف، از پشتیبان‌گیری داده‌های مهم خود مطمئن شوید. پس از تأیید
          نهایی، دسترسی و اطلاعات ورود در دسترس نخواهند بود.
        </p>
        <p>مرحله بعد: بررسی درخواست توسط ابرچین و سپس اجرای حذف کنترل‌شده.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "UPGRADE"}
        title="تأیید درخواست تغییر منابع"
        loading={busy === "UPGRADE"}
        confirmLabel="ثبت درخواست ارتقا"
        cancelLabel="انصراف"
        onCancel={() => setConfirm(null)}
        onConfirm={() => void submit("UPGRADE")}
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
