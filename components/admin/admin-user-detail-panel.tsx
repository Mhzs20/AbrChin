"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type InstanceRow = {
  id: string;
  name: string;
  status: string;
  providerInstanceId: string;
  region: string;
  ipv4: string | null;
};

type ActivityRow = {
  id: string;
  at: string;
  kind: string;
  title: string;
  detail: string;
};

export function AdminUserDetailPanel({
  userId,
  mobile,
  initialDisplayName,
  role,
  accountStatus,
  instances,
  activity,
  otherUsers,
}: {
  userId: string;
  mobile: string;
  initialDisplayName: string | null;
  role: string;
  accountStatus: string;
  instances: InstanceRow[];
  activity: ActivityRow[];
  otherUsers: Array<{ id: string; mobile: string; displayName: string | null }>;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [editRole, setEditRole] = useState(role);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [transferInstanceId, setTransferInstanceId] = useState(
    instances[0]?.id ?? "",
  );
  const [transferToUserId, setTransferToUserId] = useState(
    otherUsers[0]?.id ?? "",
  );
  const [attachInstanceId, setAttachInstanceId] = useState("");
  const [confirmMobile, setConfirmMobile] = useState("");

  async function run(
    path: string,
    init: RequestInit,
    successMessage: string,
    options?: { redirectTo?: string },
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(init.headers ?? {}),
        },
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "عملیات ناموفق بود.");
      setMessage(successMessage);
      if (options?.redirectTo) {
        router.push(options.redirectTo);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "عملیات ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error ? <p className="product-error">{error}</p> : null}
      {message ? <p className="product-muted">{message}</p> : null}

      <section className="product-section">
        <h2 className="product-section-title">ویرایش کاربر</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>نام نمایشی</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>نقش</span>
            <select
              value={editRole}
              onChange={(event) => setEditRole(event.target.value)}
            >
              <option value="CUSTOMER">مشتری</option>
              <option value="ADMIN">مدیر</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>دلیل</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
            />
          </label>
          <button
            type="button"
            className="product-btn product-btn--primary"
            disabled={busy || reason.trim().length < 3}
            onClick={() =>
              void run(
                `/api/admin/users/${userId}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    displayName,
                    role: editRole,
                    reason,
                  }),
                },
                "کاربر به‌روزرسانی شد.",
              )
            }
          >
            ذخیره ویرایش
          </button>
        </div>
      </section>

      <section className="product-section">
        <h2 className="product-section-title">مسدود / رفع مسدودی</h2>
        <p style={{ color: "var(--product-muted)" }}>
          وضعیت فعلی: {accountStatus === "BLOCKED" ? "مسدود" : "فعال"}. مسدود کردن
          Sessionها را باطل و کیف پول را Freeze می‌کند.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="product-btn"
            disabled={busy || reason.trim().length < 3 || accountStatus === "BLOCKED"}
            onClick={() =>
              void run(
                `/api/admin/users/${userId}/block`,
                {
                  method: "POST",
                  body: JSON.stringify({ blocked: true, reason }),
                },
                "کاربر مسدود شد.",
              )
            }
          >
            مسدود کردن
          </button>
          <button
            type="button"
            className="product-btn product-btn--quiet"
            disabled={busy || reason.trim().length < 3 || accountStatus !== "BLOCKED"}
            onClick={() =>
              void run(
                `/api/admin/users/${userId}/block`,
                {
                  method: "POST",
                  body: JSON.stringify({ blocked: false, reason }),
                },
                "مسدودی برداشته شد.",
              )
            }
          >
            رفع مسدودی
          </button>
        </div>
      </section>

      <section className="product-section">
        <h2 className="product-section-title">انتقال سرور به کاربر دیگر</h2>
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>سرور این کاربر</span>
            <select
              value={transferInstanceId}
              onChange={(event) => setTransferInstanceId(event.target.value)}
            >
              {instances.length === 0 ? (
                <option value="">سروری نیست</option>
              ) : (
                instances.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.status} · {row.providerInstanceId}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>کاربر مقصد</span>
            <select
              value={transferToUserId}
              onChange={(event) => setTransferToUserId(event.target.value)}
            >
              {otherUsers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.mobile}
                  {row.displayName ? ` · ${row.displayName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="product-btn"
            disabled={
              busy ||
              reason.trim().length < 3 ||
              !transferInstanceId ||
              !transferToUserId
            }
            onClick={() =>
              void run(
                `/api/admin/users/${userId}/servers`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    action: "transfer",
                    cloudInstanceId: transferInstanceId,
                    toUserId: transferToUserId,
                    reason,
                  }),
                },
                "سرور منتقل شد.",
              )
            }
          >
            انتقال سرور
          </button>
        </div>
      </section>

      <section className="product-section">
        <h2 className="product-section-title">وصل کردن سرور به این کاربر</h2>
        <p style={{ color: "var(--product-muted)" }}>
          شناسه داخلی CloudInstance را وارد کنید تا مالکیت به این کاربر منتقل شود.
        </p>
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Cloud Instance ID</span>
            <input
              dir="ltr"
              value={attachInstanceId}
              onChange={(event) => setAttachInstanceId(event.target.value)}
              placeholder="cuid…"
            />
          </label>
          <button
            type="button"
            className="product-btn"
            disabled={
              busy || reason.trim().length < 3 || attachInstanceId.trim().length < 8
            }
            onClick={() =>
              void run(
                `/api/admin/users/${userId}/servers`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    action: "attach",
                    cloudInstanceId: attachInstanceId.trim(),
                    reason,
                  }),
                },
                "سرور به کاربر وصل شد.",
              )
            }
          >
            وصل کردن سرور
          </button>
        </div>
      </section>

      <section className="product-section">
        <h2 className="product-section-title">حذف کامل</h2>
        <p style={{ color: "var(--product-muted)" }}>
          فقط وقتی سرور ندارد و موجودی کیف پول صفر است. موبایل را برای تأیید وارد
          کنید: <span className="product-tech">{mobile}</span>
        </p>
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>تأیید موبایل</span>
            <input
              dir="ltr"
              value={confirmMobile}
              onChange={(event) => setConfirmMobile(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="product-btn"
            disabled={
              busy ||
              reason.trim().length < 3 ||
              confirmMobile.trim() !== mobile
            }
            onClick={() =>
              void run(
                `/api/admin/users/${userId}`,
                {
                  method: "DELETE",
                  body: JSON.stringify({
                    reason,
                    confirmMobile,
                  }),
                },
                "کاربر حذف شد.",
                { redirectTo: "/admin/users" },
              )
            }
          >
            حذف کامل کاربر
          </button>
        </div>
      </section>

      <section className="product-section">
        <h2 className="product-section-title">تمام اکشن‌های سایت</h2>
        {activity.length === 0 ? (
          <p className="product-muted">فعلاً فعالیتی ثبت نشده است.</p>
        ) : (
          <div className="product-table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>نوع</th>
                  <th>عنوان</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.at).toLocaleString("fa-IR")}</td>
                    <td>{row.kind}</td>
                    <td>{row.title}</td>
                    <td>{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
