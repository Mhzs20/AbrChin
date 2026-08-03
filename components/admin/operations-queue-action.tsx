"use client";

import Link from "next/link";
import { useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";
import type {
  AdminOperationsActionKind,
  AdminOperationsQueueItem,
} from "@/lib/admin/operations";

const endpoints: Partial<
  Record<AdminOperationsActionKind, (id: string) => string>
> = {
  approve_activation: (id) =>
    `/api/admin/activation-requests/${id}/approve`,
  approve_resource_change: (id) =>
    `/api/admin/resource-changes/${id}/approve`,
  approve_suspension: (id) =>
    `/api/admin/dunning/${id}/approve-suspension`,
  review_reconciliation: (id) =>
    `/api/admin/billing-reconciliations/${id}/review`,
};

export function OperationsQueueAction({
  item,
}: {
  item: AdminOperationsQueueItem;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (item.action.kind === "link" && item.action.href) {
    return <Link href={item.action.href}>{item.action.label}</Link>;
  }

  const endpoint = endpoints[item.action.kind];
  if (!endpoint) return null;

  async function submit() {
    if (reason.trim().length < 3) {
      setError("دلیل عملیات باید حداقل ۳ کاراکتر باشد.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint!(item.id), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "عملیات انجام نشد.",
        );
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط با پنل برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="product-btn product-btn--quiet"
        onClick={() => {
          setOpen(true);
          setReason("");
          setError("");
          setIdempotencyKey(crypto.randomUUID());
        }}
      >
        {item.action.label}
      </button>
      <ConfirmDialog
        open={open}
        title={item.action.label}
        confirmLabel="ثبت اقدام کنترل‌شده"
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      >
        <p>
          این اقدام Audit و Idempotency دارد و به‌تنهایی Provider Mutation یا
          حذف خودکار اجرا نمی‌کند.
        </p>
        <FormField id={`operation-reason-${item.id}`} label="دلیل (الزامی)">
          <textarea
            id={`operation-reason-${item.id}`}
            rows={3}
            minLength={3}
            maxLength={500}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
