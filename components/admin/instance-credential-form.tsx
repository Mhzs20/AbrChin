"use client";

import { useState } from "react";

import { FormField } from "@/components/product";

export function InstanceCredentialForm({
  instanceId,
  currentStatus,
}: {
  instanceId: string;
  currentStatus: string | null;
}) {
  const [username, setUsername] = useState("root");
  const [secret, setSecret] = useState("");
  const [ttlHours, setTtlHours] = useState("24");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/instances/${instanceId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          secret,
          ttlHours: Number(ttlHours),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "ثبت اطلاعات دسترسی ممکن نیست.");
      setSecret("");
      setMessage("اطلاعات رمزگذاری شد و منتظر تأیید نهایی تحویل Admin است.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت اطلاعات دسترسی ممکن نیست.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p>وضعیت فعلی: <strong>{currentStatus ?? "هنوز آماده نشده"}</strong></p>
      <FormField id="instance-username" label="نام کاربری">
        <input
          id="instance-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
        />
      </FormField>
      <FormField id="instance-secret" label="رمز یا Secret اولیه">
        <input
          id="instance-secret"
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          autoComplete="new-password"
        />
      </FormField>
      <FormField id="credential-ttl" label="مهلت دریافت (ساعت)">
        <input
          id="credential-ttl"
          type="number"
          min={1}
          max={168}
          value={ttlHours}
          onChange={(event) => setTtlHours(event.target.value)}
        />
      </FormField>
      <button
        type="button"
        className="product-btn product-btn--primary"
        disabled={loading || secret.length < 8}
        onClick={submit}
      >
        {loading ? "در حال رمزگذاری..." : "آماده‌سازی تحویل یک‌بارمصرف"}
      </button>
      {message ? <p className="product-success">{message}</p> : null}
      {error ? <p className="product-error">{error}</p> : null}
    </div>
  );
}
