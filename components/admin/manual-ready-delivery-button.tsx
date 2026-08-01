"use client";

import { useRef, useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

export function ManualReadyDeliveryButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [providerResourceId, setProviderResourceId] = useState("");
  const [ipv4, setIpv4] = useState("");
  const [username, setUsername] = useState("root");
  const [secret, setSecret] = useState("");
  const [reason, setReason] = useState("تحویل دستی سفارش پرداخت‌شده");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/infrastructure/orders/${orderId}/manual-delivery`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey.current,
          },
          body: JSON.stringify({
            providerResourceId,
            ipv4,
            username,
            secret,
            reason,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "ثبت تحویل ممکن نشد.");
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
      <button
        type="button"
        className="product-btn product-btn--primary"
        onClick={() => {
          idempotencyKey.current = crypto.randomUUID();
          setError("");
          setOpen(true);
        }}
      >
        ثبت و تحویل دستی
      </button>
      <ConfirmDialog
        open={open}
        title="تحویل دستی سرور آماده"
        confirmLabel="ثبت نهایی و فعال‌سازی"
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      >
        <p>
          این عملیات هیچ درخواستی برای ساخت سرور نمی‌فرستد. فقط Resource تهیه‌شده را به همین سفارش قفل و اطلاعات دسترسی را رمزنگاری می‌کند.
        </p>
        <FormField id={`resource-${orderId}`} label="Provider Resource ID">
          <input
            id={`resource-${orderId}`}
            dir="ltr"
            value={providerResourceId}
            onChange={(event) => setProviderResourceId(event.target.value)}
          />
        </FormField>
        <FormField id={`ipv4-${orderId}`} label="IPv4">
          <input
            id={`ipv4-${orderId}`}
            dir="ltr"
            value={ipv4}
            onChange={(event) => setIpv4(event.target.value)}
          />
        </FormField>
        <FormField id={`username-${orderId}`} label="نام کاربری">
          <input
            id={`username-${orderId}`}
            dir="ltr"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </FormField>
        <FormField id={`secret-${orderId}`} label="رمز یک‌بارمصرف تحویل">
          <input
            id={`secret-${orderId}`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </FormField>
        <FormField id={`reason-${orderId}`} label="دلیل/یادداشت داخلی">
          <textarea
            id={`reason-${orderId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
          />
        </FormField>
        <p className="product-tech">رمز در Log، Audit یا پاسخ API ذخیره نمی‌شود.</p>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
