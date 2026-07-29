"use client";

import { Copy, Eye } from "lucide-react";
import { useState } from "react";

type RevealedCredential = {
  username: string;
  secret: string;
  ipv4: string | null;
};

export function CredentialRevealPanel({
  instanceId,
  ipv4,
  credentialStatus,
  credentialExpiresAt,
}: {
  instanceId: string;
  ipv4: string;
  credentialStatus: string | null;
  credentialExpiresAt: string | null;
}) {
  const [credential, setCredential] = useState<RevealedCredential | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const ready = credentialStatus === "READY";

  async function reveal() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/account/instances/${instanceId}/credentials/reveal`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "دریافت اطلاعات دسترسی ممکن نیست.");
      setCredential(body.credential);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "دریافت اطلاعات دسترسی ممکن نیست.");
    } finally {
      setLoading(false);
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  if (credential) {
    return (
      <div className="product-card">
        <h3>اطلاعات دسترسی یک‌بارمصرف</h3>
        <p className="product-warning">
          این اطلاعات بعد از بستن صفحه دوباره نمایش داده نمی‌شود. همین حالا در محل امن ذخیره کن.
        </p>
        <p>IP: <strong dir="ltr">{credential.ipv4}</strong>{" "}
          <button type="button" onClick={() => copy(credential.ipv4 ?? "")}><Copy size={14} /></button>
        </p>
        <p>کاربر: <strong dir="ltr">{credential.username}</strong>{" "}
          <button type="button" onClick={() => copy(credential.username)}><Copy size={14} /></button>
        </p>
        <p>Secret: <strong dir="ltr">{credential.secret}</strong>{" "}
          <button type="button" onClick={() => copy(credential.secret)}><Copy size={14} /></button>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p>IP سرور: <strong dir="ltr">{ipv4}</strong></p>
      {ready ? (
        <>
          <p>
            اطلاعات دسترسی آماده است
            {credentialExpiresAt
              ? ` و تا ${new Date(credentialExpiresAt).toLocaleString("fa-IR")} قابل دریافت است.`
              : "."}
          </p>
          <button
            type="button"
            className="product-btn product-btn--primary"
            disabled={loading}
            onClick={reveal}
          >
            <Eye size={16} />
            {loading ? "در حال دریافت..." : "فقط یک‌بار نمایش بده"}
          </button>
        </>
      ) : (
        <p>
          {credentialStatus === "REVEALED"
            ? "اطلاعات دسترسی قبلاً دریافت شده است."
            : "تحویل امن اطلاعات دسترسی در حال آماده‌سازی است."}
        </p>
      )}
      {error ? <p className="product-error">{error}</p> : null}
    </div>
  );
}
