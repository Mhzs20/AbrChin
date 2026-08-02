"use client";

import { useRef, useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

export function ManualProvisionButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [providerResourceId, setProviderResourceId] = useState("");
  const [ipv4, setIpv4] = useState("");
  const [username, setUsername] = useState("root");
  const [secret, setSecret] = useState("");
  const [region, setRegion] = useState("");
  const [externalPlanId, setExternalPlanId] = useState("");
  const [externalImageId, setExternalImageId] = useState("");
  const [reason, setReason] = useState("Fulfillment دستی پس از تأیید ساخت");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/infrastructure/orders/${orderId}/fulfill-manually`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey.current,
          },
          body: JSON.stringify({
            providerResourceId,
            ipv4,
            region,
            externalPlanId,
            externalImageId,
            username,
            secret,
            reason,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "ثبت Fulfillment ممکن نشد.");
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
        ثبت Fulfillment دستی
      </button>
      <ConfirmDialog
        open={open}
        title="Fulfillment دستی پس از تأیید ساخت"
        confirmLabel="ثبت Resource برای تأیید تحویل"
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      >
        <p>
          این عملیات هیچ درخواستی برای ساخت سرور نمی‌فرستد. فقط Resource تهیه‌شده را با Snapshot پرداخت تطبیق می‌دهد و Credential را رمزنگاری می‌کند؛ Customer هنوز هیچ اطلاعاتی دریافت نمی‌کند.
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
        <FormField id={`region-${orderId}`} label="Region ثبت‌شده در Provider">
          <input
            id={`region-${orderId}`}
            dir="ltr"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
        </FormField>
        <FormField id={`plan-${orderId}`} label="Provider Plan / Flavor ID">
          <input
            id={`plan-${orderId}`}
            dir="ltr"
            value={externalPlanId}
            onChange={(event) => setExternalPlanId(event.target.value)}
          />
        </FormField>
        <FormField id={`image-${orderId}`} label="Provider Image / OS ID">
          <input
            id={`image-${orderId}`}
            dir="ltr"
            value={externalImageId}
            onChange={(event) => setExternalImageId(event.target.value)}
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
        <FormField id={`secret-${orderId}`} label="Credential ثبت‌شده برای تأیید تحویل">
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
