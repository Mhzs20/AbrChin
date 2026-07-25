"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";

type Gateway = {
  id: string;
  provider: "ZIBAL" | "ZARINPAL" | "MOCK";
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  environment: "DEVELOPMENT" | "SANDBOX" | "PRODUCTION";
  updatedAt: string;
  updatedBy: { id: string; mobile: string; displayName: string | null } | null;
  serverConfigured: boolean;
  canEnable: boolean;
  configurationMessage: string | null;
};

const ENV_LABEL: Record<Gateway["environment"], string> = {
  DEVELOPMENT: "توسعه",
  SANDBOX: "سندباکس",
  PRODUCTION: "پروداکشن",
};

export function AdminPaymentGatewaysPanel({ initialGateways }: { initialGateways: Gateway[] }) {
  const [gateways, setGateways] = useState<Gateway[]>(initialGateways);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDefault, setConfirmDefault] = useState<Gateway | null>(null);

  async function patchGateway(
    provider: string,
    body: { enabled?: boolean; priority?: number; environment?: Gateway["environment"] },
  ) {
    if (busyProvider) return;
    setBusyProvider(provider);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/payment-gateways/${provider.toLowerCase()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || "ذخیره ناموفق بود.");
        return;
      }
      setGateways(json.gateways || []);
      setMessage(json.message || "ذخیره شد.");
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function makeDefault(provider: string) {
    if (busyProvider) return;
    setBusyProvider(provider);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/payment-gateways/${provider.toLowerCase()}/make-default`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || "تغییر پیش‌فرض ناموفق بود.");
        return;
      }
      setGateways(json.gateways || []);
      setMessage(json.message || "درگاه پیش‌فرض تغییر کرد.");
      setConfirmDefault(null);
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <div className="account-stack">
      {error ? <p className="auth-error">{error}</p> : null}
      {message ? <p className="auth-success">{message}</p> : null}

      <div className="gateway-admin-list">
        {gateways.map((gateway) => {
          const busy = busyProvider === gateway.provider;
          const disableToggle =
            busy ||
            (!gateway.canEnable && !gateway.enabled) ||
            (gateway.isDefault && gateway.enabled);

          return (
            <article key={gateway.id} className="account-card gateway-admin-card">
              <div className="account-card-head">
                <h2>{gateway.displayName}</h2>
                <p>
                  Provider: <span dir="ltr">{gateway.provider}</span>
                  {gateway.isDefault ? " · پیش‌فرض" : ""}
                </p>
              </div>

              <dl className="gateway-admin-meta">
                <div>
                  <dt>وضعیت</dt>
                  <dd>{gateway.enabled ? "فعال" : "غیرفعال"}</dd>
                </div>
                <div>
                  <dt>اولویت</dt>
                  <dd>{gateway.priority}</dd>
                </div>
                <div>
                  <dt>محیط</dt>
                  <dd>{ENV_LABEL[gateway.environment]}</dd>
                </div>
                <div>
                  <dt>آمادگی سرور</dt>
                  <dd>
                    {gateway.serverConfigured
                      ? "آماده"
                      : gateway.configurationMessage || "اطلاعات اتصال روی سرور تنظیم نشده است"}
                  </dd>
                </div>
                <div>
                  <dt>آخرین ویرایش</dt>
                  <dd>{new Date(gateway.updatedAt).toLocaleString("fa-IR")}</dd>
                </div>
                <div>
                  <dt>مدیر</dt>
                  <dd>{gateway.updatedBy?.displayName || gateway.updatedBy?.mobile || "—"}</dd>
                </div>
              </dl>

              <div className="account-actions gateway-admin-actions">
                <label className="gateway-toggle">
                  <input
                    type="checkbox"
                    checked={gateway.enabled}
                    disabled={disableToggle || (gateway.provider === "MOCK" && !gateway.canEnable)}
                    onChange={(event) => {
                      if (gateway.isDefault && !event.target.checked) {
                        setError("ابتدا درگاه دیگری را پیش‌فرض کنید.");
                        return;
                      }
                      void patchGateway(gateway.provider, { enabled: event.target.checked });
                    }}
                  />
                  <span>فعال</span>
                </label>

                <label className="gateway-priority">
                  <span>اولویت</span>
                  <input
                    type="number"
                    min={1}
                    dir="ltr"
                    defaultValue={gateway.priority}
                    disabled={busy}
                    onBlur={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(value) || value === gateway.priority) return;
                      void patchGateway(gateway.provider, { priority: value });
                    }}
                  />
                </label>

                {gateway.provider !== "MOCK" ? (
                  <label className="gateway-env">
                    <span>محیط</span>
                    <select
                      value={gateway.environment === "DEVELOPMENT" ? "SANDBOX" : gateway.environment}
                      disabled={busy || gateway.provider === "ZIBAL"}
                      onChange={(event) => {
                        const value = event.target.value as Gateway["environment"];
                        void patchGateway(gateway.provider, { environment: value });
                      }}
                    >
                      <option value="SANDBOX">سندباکس</option>
                      <option value="PRODUCTION">پروداکشن</option>
                    </select>
                  </label>
                ) : null}

                <button
                  type="button"
                  className="button button-quiet"
                  disabled={busy || gateway.isDefault || !gateway.canEnable}
                  onClick={() => setConfirmDefault(gateway)}
                >
                  {gateway.isDefault ? "پیش‌فرض فعلی" : "انتخاب به‌عنوان پیش‌فرض"}
                </button>
              </div>

              {!gateway.serverConfigured ? (
                <p className="auth-error">اطلاعات اتصال روی سرور تنظیم نشده است</p>
              ) : null}
              {busy ? (
                <p className="account-empty">
                  <LoaderCircle className="spin" size={16} /> در حال ذخیره...
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      {confirmDefault ? (
        <div className="gateway-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="auth-card gateway-confirm-modal">
            <div className="auth-card-head">
              <h2>تغییر درگاه پیش‌فرض</h2>
              <p>
                درگاه پیش‌فرض به «{confirmDefault.displayName}» تغییر کند؟ شارژهای جدید از این درگاه استفاده
                می‌کنند؛ پرداخت‌های در جریان روی درگاه قبلی می‌مانند.
              </p>
            </div>
            <div className="account-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={Boolean(busyProvider)}
                onClick={() => void makeDefault(confirmDefault.provider)}
              >
                تأیید
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={Boolean(busyProvider)}
                onClick={() => setConfirmDefault(null)}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
