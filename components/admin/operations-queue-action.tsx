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
  fulfill_resource_change: (id) =>
    `/api/admin/resource-changes/${id}/fulfill-manually`,
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
  const [vcpu, setVcpu] = useState("1");
  const [ramMb, setRamMb] = useState("1024");
  const [diskGb, setDiskGb] = useState("20");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (item.action.kind === "link" && item.action.href) {
    return <Link href={item.action.href}>{item.action.label}</Link>;
  }

  const endpoint = endpoints[item.action.kind];
  if (!endpoint) return null;

  const isFulfill = item.action.kind === "fulfill_resource_change";

  async function submit() {
    if (!isFulfill && reason.trim().length < 3) {
      setError("دلیل عملیات باید حداقل ۳ کاراکتر باشد.");
      return;
    }
    if (isFulfill) {
      const v = Number(vcpu);
      const r = Number(ramMb);
      const d = Number(diskGb);
      if (!Number.isInteger(v) || v < 1 || !Number.isInteger(r) || r < 256) {
        setError("vCPU و RAM معتبر وارد کنید.");
        return;
      }
      if (!Number.isInteger(d) || d < 0) {
        setError("Disk معتبر وارد کنید.");
        return;
      }
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
        body: JSON.stringify(
          isFulfill
            ? {
                idempotencyKey,
                vcpu: Number(vcpu),
                ramMb: Number(ramMb),
                diskGb: Number(diskGb),
                note: reason.trim() || "manual fulfill",
              }
            : { reason: reason.trim() },
        ),
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
        {isFulfill ? (
          <>
            <FormField id={`fulfill-vcpu-${item.id}`} label="vCPU واقعی">
              <input
                id={`fulfill-vcpu-${item.id}`}
                type="number"
                min={1}
                value={vcpu}
                onChange={(event) => setVcpu(event.target.value)}
              />
            </FormField>
            <FormField id={`fulfill-ram-${item.id}`} label="RAM (MB)">
              <input
                id={`fulfill-ram-${item.id}`}
                type="number"
                min={256}
                value={ramMb}
                onChange={(event) => setRamMb(event.target.value)}
              />
            </FormField>
            <FormField id={`fulfill-disk-${item.id}`} label="Disk (GB)">
              <input
                id={`fulfill-disk-${item.id}`}
                type="number"
                min={0}
                value={diskGb}
                onChange={(event) => setDiskGb(event.target.value)}
              />
            </FormField>
            <FormField id={`fulfill-note-${item.id}`} label="یادداشت (اختیاری)">
              <textarea
                id={`fulfill-note-${item.id}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </FormField>
          </>
        ) : (
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
        )}
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
