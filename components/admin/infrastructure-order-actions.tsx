"use client";

import { useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

type ActionKind =
  | "reconcile"
  | "retry"
  | "health-retry"
  | "health-observe"
  | "health-recovery"
  | "refund"
  | "confirm-no-resource";

const actionConfig: Record<
  ActionKind,
  { label: string; title: string; endpoint: (id: string) => string; confirmLabel: string }
> = {
  reconcile: {
    label: "تطبیق",
    title: "تطبیق با Provider",
    endpoint: (id) => `/api/admin/infrastructure/orders/${id}/reconcile`,
    confirmLabel: "اجرای تطبیق",
  },
  retry: {
    label: "تلاش مجدد",
    title: "تلاش مجدد Provisioning",
    endpoint: (id) => `/api/admin/infrastructure/orders/${id}/retry`,
    confirmLabel: "اجرای Retry",
  },
  "health-retry": {
    label: "Retry سلامت",
    title: "تلاش مجدد بررسی سلامت",
    endpoint: (id) =>
      `/api/admin/infrastructure/orders/${id}/health-retry`,
    confirmLabel: "ثبت Retry سلامت",
  },
  "health-observe": {
    label: "مشاهده Provider",
    title: "مشاهده و تطبیق مجدد Provider",
    endpoint: (id) =>
      `/api/admin/infrastructure/orders/${id}/health-observe`,
    confirmLabel: "اجرای تطبیق فقط‌خواندنی",
  },
  "health-recovery": {
    label: "بررسی سلامت پس از اصلاح",
    title: "اجرای Recovery دستی سلامت",
    endpoint: (id) =>
      `/api/admin/infrastructure/orders/${id}/health-recovery`,
    confirmLabel: "ثبت Recovery سلامت",
  },
  refund: {
    label: "لغو و بازگشت وجه",
    title: "بستن پرونده و بازگشت وجه",
    endpoint: (id) => `/api/admin/orders/${id}/refund`,
    confirmLabel: "تأیید بازگشت وجه",
  },
  "confirm-no-resource": {
    label: "منبع ساخته نشده",
    title: "تأیید منبع ساخته‌نشده",
    endpoint: (id) => `/api/admin/infrastructure/orders/${id}/confirm-no-resource`,
    confirmLabel: "تأیید نهایی",
  },
};

export function InfrastructureOrderActions({
  orderId,
  serviceOrderId,
  allowedActions,
  resourceDispositionReason,
}: {
  orderId: string;
  serviceOrderId: string;
  allowedActions: ActionKind[];
  resourceDispositionReason: string;
}) {
  const [kind, setKind] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  if (allowedActions.length === 0) {
    return (
      <span
        className="product-tech"
        title={resourceDispositionReason}
      >
        —
      </span>
    );
  }

  async function submit() {
    if (!kind) return;
    if (reason.trim().length < 3) {
      setError("دلیل الزامی است (حداقل ۳ کاراکتر).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const config = actionConfig[kind];
      const endpointId =
        kind === "refund" ? serviceOrderId : orderId;
      const response = await fetch(config.endpoint(endpointId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...([
            "health-retry",
            "health-observe",
            "health-recovery",
          ].includes(kind)
            ? { "Idempotency-Key": idempotencyKey }
            : {}),
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "عملیات ممکن نشد.");
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {allowedActions.map((action) => (
          <button
            key={action}
            type="button"
            className="product-btn product-btn--quiet"
            onClick={() => {
              setKind(action);
              setReason("");
              setError("");
              setIdempotencyKey(crypto.randomUUID());
            }}
          >
            {actionConfig[action].label}
          </button>
        ))}
      </div>
      {kind ? (
        <ConfirmDialog
          open
          title={actionConfig[kind].title}
          confirmLabel={actionConfig[kind].confirmLabel}
          loading={loading}
          onCancel={() => setKind(null)}
          onConfirm={submit}
        >
          <FormField id={`reason-${orderId}`} label="دلیل (الزامی)">
            <textarea
              id={`reason-${orderId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              minLength={3}
            />
          </FormField>
          {error ? <p className="product-error">{error}</p> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
