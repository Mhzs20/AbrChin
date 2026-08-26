"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorState, FormField, SectionCard } from "@/components/product";
import { STABLE_FAMILY_ALIASES } from "@/lib/messagego/customer/handoff";
import type { CustomerConnectionView } from "@/lib/messagego/customer/surface";

const ownershipLabels: Record<CustomerConnectionView["ownership_mode"], string> = {
  PLATFORM_MANAGED: "مدیریت‌شده توسط پلتفرم",
  ACCOUNT_BYOK: "کلید حساب (یک‌بار تحویل به MessageGo)",
  PROJECT_BYOK: "کلید فضای کاری (یک‌بار تحویل به MessageGo)",
};

const statusLabels: Record<CustomerConnectionView["status"], string> = {
  UNCONFIGURED: "پیکربندی نشده",
  HANDOFF_REQUIRED: "نیاز به تحویل کلید",
  CONNECTED: "متصل",
  CONTROL_PLANE_UNAVAILABLE: "کنترل‌پلن در دسترس نیست",
  HANDOFF_FAILED: "تحویل کلید ناموفق",
};

export function AiConnectionForm({
  failClosed,
  connections,
}: {
  failClosed: boolean;
  connections: CustomerConnectionView[];
}) {
  const router = useRouter();
  const [alias, setAlias] = useState("default");
  const [productId, setProductId] = useState("abrchin");
  const [workspaceId, setWorkspaceId] = useState("default");
  const [ownershipMode, setOwnershipMode] = useState<
    CustomerConnectionView["ownership_mode"]
  >("ACCOUNT_BYOK");
  const [familyAlias, setFamilyAlias] = useState<(typeof STABLE_FAMILY_ALIASES)[number]>(
    "openai-compatible",
  );
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/account/ai-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias,
          product_id: productId,
          workspace_id: workspaceId,
          ownership_mode: ownershipMode,
          family_alias: familyAlias,
          credential: ownershipMode === "PLATFORM_MANAGED" ? "" : credential,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        connection?: CustomerConnectionView;
      };
      setCredential("");
      if (!response.ok) {
        setError(data.error || "تحویل اتصال انجام نشد.");
        return;
      }
      router.refresh();
    } catch {
      setCredential("");
      setError("ارتباط برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="اتصال MessageGo">
      <p>
        اجرای مدل و نگهداری کلید ارائه‌دهنده با MessageGo است. ابرچین فقط وضعیت تجاری حساب و
        فرادادهٔ بدون Secret را نگه می‌دارد.
      </p>
      {failClosed ? (
        <ErrorState message="اتصال کنترل‌پلن MessageGo در دسترس نیست. ثبت کلید و اجرای مدل در ابرچین انجام نمی‌شود." />
      ) : null}
      {connections.length > 0 ? (
        <ul style={{ margin: "12px 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {connections.map((connection) => (
            <li key={connection.id}>
              <strong>{connection.alias}</strong>
              {" — "}
              {statusLabels[connection.status]}
              {" · "}
              {ownershipLabels[connection.ownership_mode]}
              {connection.family_alias ? ` · ${connection.family_alias}` : ""}
              <div className="product-tech">
                محصول {connection.product_id} / فضای کاری {connection.workspace_id}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>هنوز اتصال مشتری ثبت نشده است.</p>
      )}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <FormField id="ai-alias" label="نام اتصال">
          <input
            id="ai-alias"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            required
          />
        </FormField>
        <FormField id="ai-product" label="شناسه محصول">
          <input
            id="ai-product"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            required
          />
        </FormField>
        <FormField id="ai-workspace" label="فضای کاری">
          <input
            id="ai-workspace"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            required
          />
        </FormField>
        <FormField id="ai-ownership" label="نوع اتصال">
          <select
            id="ai-ownership"
            value={ownershipMode}
            onChange={(event) =>
              setOwnershipMode(event.target.value as CustomerConnectionView["ownership_mode"])
            }
          >
            <option value="PLATFORM_MANAGED">پلتفرم ابرچین / MessageGo</option>
            <option value="ACCOUNT_BYOK">کلید حساب — تحویل یک‌باره</option>
            <option value="PROJECT_BYOK">کلید فضای کاری — تحویل یک‌باره</option>
          </select>
        </FormField>
        <FormField id="ai-family" label="خانواده مدل پایدار">
          <select
            id="ai-family"
            value={familyAlias}
            onChange={(event) =>
              setFamilyAlias(event.target.value as (typeof STABLE_FAMILY_ALIASES)[number])
            }
          >
            {STABLE_FAMILY_ALIASES.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </FormField>
        {ownershipMode !== "PLATFORM_MANAGED" ? (
          <FormField
            id="ai-credential"
            label="کلید ارائه‌دهنده"
            hint="فقط برای تحویل یک‌باره به MessageGo؛ در ابرچین ذخیره نمی‌شود."
          >
            <input
              id="ai-credential"
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              required
            />
          </FormField>
        ) : null}
        <button className="product-btn product-btn--primary" type="submit" disabled={busy}>
          {busy ? "در حال ارسال" : "ثبت اتصال"}
        </button>
        {error ? <ErrorState message={error} /> : null}
      </form>
    </SectionCard>
  );
}
