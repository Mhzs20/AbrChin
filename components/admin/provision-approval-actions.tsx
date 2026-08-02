"use client";

import { useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

type Action = "approve" | "hold" | "refund";

export function ProvisionApprovalActions({
  orderId,
  serviceOrderId,
  canApprove,
  requiresBalanceConfirmation,
  provisioningLabel,
  blockingMessages,
}: {
  orderId: string;
  serviceOrderId: string;
  canApprove: boolean;
  requiresBalanceConfirmation: boolean;
  provisioningLabel: string;
  blockingMessages: string[];
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [balanceConfirmed, setBalanceConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function open(next: Action) {
    setAction(next);
    setError("");
    setBalanceConfirmed(false);
    setReason(
      next === "approve"
        ? "هزینه، موجودی و وضعیت Provider بررسی شد."
        : next === "hold"
          ? "برای بررسی دستی نگه داشته شد."
          : "بازگشت وجه پیش از Provision درخواست شد.",
    );
  }

  async function submit() {
    if (!action) return;
    if (reason.trim().length < 3) {
      setError("دلیل عملیات الزامی است (حداقل ۳ کاراکتر).");
      return;
    }
    if (action === "approve" && requiresBalanceConfirmation && !balanceConfirmed) {
      setError("تأیید بررسی دستی موجودی یا شارژ Provider الزامی است.");
      return;
    }
    const endpoint =
      action === "approve"
        ? `/api/admin/infrastructure/orders/${orderId}/approve-provision`
        : action === "hold"
          ? `/api/admin/infrastructure/orders/${orderId}/hold-provision`
          : `/api/admin/orders/${serviceOrderId}/refund`;
    const idempotencyKey =
      action === "approve"
        ? `provision-approve:${orderId}`
        : action === "hold"
          ? `provision-hold:${orderId}`
          : `provision-refund:${serviceOrderId}`;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          reason: reason.trim(),
          providerBalanceConfirmed: action === "approve" && balanceConfirmed,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "عملیات ممکن نشد.");
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="product-btn product-btn--primary"
          disabled={!canApprove}
          title={canApprove ? provisioningLabel : blockingMessages.join(" ")}
          onClick={() => open("approve")}
        >
          تأیید و ساخت/تخصیص سرور
        </button>
        <button type="button" className="product-btn product-btn--quiet" onClick={() => open("hold")}>
          نگه‌داشتن برای بررسی
        </button>
        <button type="button" className="product-btn product-btn--quiet" onClick={() => open("refund")}>
          لغو / بازگشت وجه
        </button>
      </div>
      {blockingMessages.length > 0 ? (
        <p className="product-error" style={{ margin: "8px 0 0" }}>
          {blockingMessages.join(" ")}
        </p>
      ) : null}
      {action ? (
        <ConfirmDialog
          open
          title={
            action === "approve"
              ? "تأیید اول: ساخت یا تخصیص"
              : action === "hold"
                ? "نگه‌داشتن سفارش"
                : "لغو و بازگشت وجه"
          }
          confirmLabel={
            action === "approve"
              ? "ثبت تأیید ساخت"
              : action === "hold"
                ? "نگه‌داشتن سفارش"
                : "ثبت بازگشت وجه"
          }
          loading={loading}
          onCancel={() => setAction(null)}
          onConfirm={submit}
        >
          {action === "approve" ? (
            <p>{provisioningLabel}. این مرحله هیچ Resource یا Job ساخت ایجاد نمی‌کند.</p>
          ) : null}
          {action === "approve" && requiresBalanceConfirmation ? (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={balanceConfirmed}
                onChange={(event) => setBalanceConfirmed(event.target.checked)}
              />
              موجودی یا شارژ Provider را دستی بررسی کردم؛ هیچ شارژ خودکاری انجام نمی‌شود.
            </label>
          ) : null}
          <FormField id={`provision-reason-${orderId}`} label="دلیل/یادداشت داخلی">
            <textarea
              id={`provision-reason-${orderId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              minLength={3}
              required
            />
          </FormField>
          {error ? <p className="product-error">{error}</p> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
