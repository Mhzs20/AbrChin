"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type UserRow = {
  id: string;
  mobile: string;
  displayName: string | null;
  role: string;
  accountStatus: string;
  ordersCount: number;
  serversCount: number;
  balanceTomanFa: string;
  createdAt: string;
};

export function AdminUsersCreateForm() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function createUser() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          mobile,
          displayName,
          role: "CUSTOMER",
          reason,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        result?: { userId: string };
      };
      if (!response.ok) throw new Error(data.error || "ساخت کاربر ممکن نشد.");
      setMessage("کاربر ساخته شد.");
      if (data.result?.userId) {
        router.push(`/admin/users/${data.result.userId}`);
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ساخت کاربر ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span>موبایل</span>
        <input
          dir="ltr"
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
          placeholder="0912…"
        />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span>نام نمایشی</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span>دلیل (Audit)</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={3}
          placeholder="مثلاً ساخت دستی مشتری"
        />
      </label>
      <button
        type="button"
        className="product-btn product-btn--primary"
        disabled={busy || mobile.trim().length < 10 || reason.trim().length < 3}
        onClick={() => void createUser()}
      >
        ساخت کاربر
      </button>
      {error ? <p className="product-error">{error}</p> : null}
      {message ? <p className="product-muted">{message}</p> : null}
    </div>
  );
}

export function AdminUserActionsLink({ user }: { user: UserRow }) {
  return (
    <Link
      href={`/admin/users/${user.id}`}
      className="product-btn product-btn--quiet"
    >
      عملیات
    </Link>
  );
}
