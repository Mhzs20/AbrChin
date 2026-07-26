"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormField, PageHeader, SectionCard } from "@/components/product";
import { performLogout } from "@/lib/auth-client";

type ProfileUser = {
  mobile: string;
  displayName: string | null;
  mobileVerifiedAt: string | null;
  createdAt: string;
};

export function ProfilePanel({ user }: { user: ProfileUser }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = (await response.json()) as { error?: string; user?: { displayName?: string } };
      if (!response.ok) {
        setError(data.error || "ذخیره نام ممکن نشد.");
        return;
      }
      setDisplayName(data.user?.displayName ?? displayName);
      setMessage("نام با موفقیت ذخیره شد.");
      router.refresh();
    } catch {
      setError("ارتباط با سرور برقرار نشد.");
    } finally {
      setSaving(false);
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    setError("");
    try {
      await performLogout("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خروج ممکن نشد.");
      setLoggingOut(false);
    }
  }

  const joinedAt = new Date(user.createdAt).toLocaleDateString("fa-IR");

  return (
    <>
      <PageHeader title="پروفایل" description="اطلاعات حساب و خروج امن" />
      <SectionCard>
        <dl style={{ display: "grid", gap: 12, marginBottom: 24 }}>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>شماره موبایل</dt>
            <dd className="product-tech" style={{ margin: "4px 0 0" }}>{user.mobile}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>وضعیت تأیید موبایل</dt>
            <dd style={{ margin: "4px 0 0" }}>{user.mobileVerifiedAt ? "تأیید شده" : "تأیید نشده"}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>تاریخ عضویت</dt>
            <dd style={{ margin: "4px 0 0" }}>{joinedAt}</dd>
          </div>
        </dl>

        <form onSubmit={onSave}>
          <FormField id="display-name" label="نام نمایشی">
            <input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              minLength={2}
              maxLength={64}
              required
              disabled={saving || loggingOut}
            />
          </FormField>
          {error ? <p className="product-error" role="alert">{error}</p> : null}
          {message ? <p style={{ color: "#16845f" }} role="status">{message}</p> : null}
          <button type="submit" className="product-btn product-btn--primary" disabled={saving || loggingOut}>
            {saving ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : null}
            ذخیره نام
          </button>
        </form>

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--product-line)" }}>
          <button
            type="button"
            className="product-btn product-btn--quiet"
            onClick={onLogout}
            disabled={loggingOut || saving}
          >
            {loggingOut ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <LogOut size={16} aria-hidden="true" />}
            خروج از حساب
          </button>
        </div>
      </SectionCard>
    </>
  );
}
