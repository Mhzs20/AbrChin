"use client";

import { useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

export function DeliveryApprovalActions({
  orderId,
  canApprove,
  blockingMessages,
}: {
  orderId: string;
  canApprove: boolean;
  blockingMessages: string[];
}) {
  const [action, setAction] = useState<"approve" | "hold" | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function open(next: "approve" | "hold") {
    setAction(next);
    setError("");
    setReason(
      next === "approve"
        ? "Resource، Health و مسیر تحویل امن بررسی شد."
        : "تحویل برای بررسی دستی نگه داشته شد.",
    );
  }

  async function submit() {
    if (!action) return;
    if (reason.trim().length < 3) {
      setError("دلیل عملیات الزامی است (حداقل ۳ کاراکتر).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const actionName = action === "approve" ? "approve" : "hold";
      const response = await fetch(
        `/api/admin/infrastructure/orders/${orderId}/${actionName}-delivery`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `delivery-${actionName}:${orderId}`,
          },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
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
          title={canApprove ? "تأیید دوم و فعال‌سازی سرویس" : blockingMessages.join(" ")}
          onClick={() => open("approve")}
        >
          تأیید نهایی تحویل
        </button>
        <button type="button" className="product-btn product-btn--quiet" onClick={() => open("hold")}>
          نگه‌داشتن تحویل
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
          title={action === "approve" ? "تأیید دوم: تحویل امن" : "نگه‌داشتن تحویل"}
          confirmLabel={action === "approve" ? "فعال‌سازی پس از تأیید" : "نگه‌داشتن"}
          loading={loading}
          onCancel={() => setAction(null)}
          onConfirm={submit}
        >
          {action === "approve" ? (
            <p>پس از این تأیید، سرویس فعال می‌شود و فقط سپس مسیر نمایش امن Credential به مشتری باز خواهد شد.</p>
          ) : null}
          <FormField id={`delivery-reason-${orderId}`} label="دلیل/یادداشت داخلی">
            <textarea
              id={`delivery-reason-${orderId}`}
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
