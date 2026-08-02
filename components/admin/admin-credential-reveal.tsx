"use client";

import { Copy, Eye } from "lucide-react";
import { useState } from "react";

type Credential = { username: string; secret: string; ipv4: string | null };

/** No credential data is passed from the server. It is requested only after an
 * explicit Admin action while the order remains in the second approval queue. */
export function AdminCredentialReveal({
  instanceId,
  credentialStatus,
}: {
  instanceId: string;
  credentialStatus: string | null;
}) {
  const [credential, setCredential] = useState<Credential | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function reveal() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/instances/${instanceId}/credentials/reveal`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "بازبینی Credential ممکن نیست.");
      setCredential(body.credential);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "بازبینی Credential ممکن نیست.");
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
        <p className="product-warning">Credential فقط در همین نشست مرورگر نمایش داده شده و در Audit ثبت شده است.</p>
        <p>IP: <strong dir="ltr">{credential.ipv4 ?? "—"}</strong> <button type="button" onClick={() => copy(credential.ipv4 ?? "")}><Copy size={14} /></button></p>
        <p>کاربر: <strong dir="ltr">{credential.username}</strong> <button type="button" onClick={() => copy(credential.username)}><Copy size={14} /></button></p>
        <p>Secret: <strong dir="ltr">{credential.secret}</strong> <button type="button" onClick={() => copy(credential.secret)}><Copy size={14} /></button></p>
      </div>
    );
  }

  return (
    <div>
      <p>وضعیت Credential: <strong>{credentialStatus ?? "ثبت نشده"}</strong></p>
      {credentialStatus === "READY" ? (
        <button type="button" className="product-btn product-btn--quiet" disabled={loading} onClick={reveal}>
          <Eye size={16} />
          {loading ? "در حال بازبینی..." : "بازبینی محافظت‌شده Credential"}
        </button>
      ) : null}
      {error ? <p className="product-error">{error}</p> : null}
    </div>
  );
}
