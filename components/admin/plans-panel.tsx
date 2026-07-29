"use client";

import { useMemo, useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

type PlanRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  deliveryMode: string;
  catalogItemId: string | null;
  catalogMappingStatus: string;
  imageCode: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  active: boolean;
  sortOrder: number;
};

type CatalogRow = {
  id: string;
  regionCode: string;
  sizeCode: string;
  compatibleImageCodes: string[];
  vcpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
  available: boolean;
  basePriceRial: string | null;
  finalPriceRial: string | null;
};

const emptyForm = {
  code: "",
  title: "",
  description: "",
  deliveryMode: "RAW",
  catalogItemId: "",
  imageCode: "",
  deliveryEstimateMinutes: "15",
  parchinIncluded: false,
  active: true,
  sortOrder: "0",
};

function toman(value: string | null) {
  return value ? `${(BigInt(value) / 10n).toLocaleString("fa-IR")} تومان` : "نامعتبر";
}

export function AdminPlansPanel({
  initialPlans,
  catalogItems,
}: {
  initialPlans: PlanRow[];
  catalogItems: CatalogRow[];
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const selectedCatalog = useMemo(
    () => catalogItems.find((item) => item.id === form.catalogItemId) ?? null,
    [catalogItems, form.catalogItemId],
  );

  function openCreate() {
    const first = catalogItems.find((item) => item.available && item.finalPriceRial);
    setEditing(null);
    setForm({
      ...emptyForm,
      catalogItemId: first?.id ?? "",
      imageCode: first?.compatibleImageCodes[0] ?? "",
    });
    setError("");
    setOpen(true);
  }

  function openEdit(plan: PlanRow) {
    setEditing(plan);
    setForm({
      code: plan.code,
      title: plan.title,
      description: plan.description ?? "",
      deliveryMode: plan.deliveryMode,
      catalogItemId: plan.catalogItemId ?? "",
      imageCode: plan.imageCode,
      deliveryEstimateMinutes: String(plan.deliveryEstimateMinutes),
      parchinIncluded: plan.parchinIncluded,
      active: plan.active,
      sortOrder: String(plan.sortOrder),
    });
    setError("");
    setOpen(true);
  }

  function selectCatalog(catalogItemId: string) {
    const item = catalogItems.find((candidate) => candidate.id === catalogItemId);
    setForm((current) => ({
      ...current,
      catalogItemId,
      imageCode: item?.compatibleImageCodes[0] ?? "",
    }));
  }

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        ...form,
        deliveryEstimateMinutes: Number(form.deliveryEstimateMinutes),
        sortOrder: Number(form.sortOrder),
      };
      const response = await fetch(
        editing
          ? `/api/admin/infrastructure/plans/${editing.id}`
          : "/api/admin/infrastructure/plans",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "ذخیره ممکن نشد.");
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <button type="button" className="product-btn product-btn--primary" onClick={openCreate}>
          پلن جدید
        </button>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {initialPlans.map((plan) => (
          <li key={plan.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>
              {plan.title} <span className="product-tech">({plan.code})</span>
              {plan.catalogMappingStatus !== "MAPPED" ? " · بدون Mapping" : ""}
            </span>
            <button type="button" className="product-btn product-btn--quiet" onClick={() => openEdit(plan)}>
              ویرایش
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={open}
        title={editing ? "ویرایش پلن" : "پلن جدید"}
        confirmLabel="ذخیره"
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      >
        <FormField id="plan-code" label="کد">
          <input id="plan-code" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} disabled={Boolean(editing)} required />
        </FormField>
        <FormField id="plan-title" label="عنوان">
          <input id="plan-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required />
        </FormField>
        <FormField id="plan-desc" label="توضیحات">
          <textarea id="plan-desc" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={2} />
        </FormField>
        <FormField id="plan-mode" label="سطح همراهی">
          <select id="plan-mode" value={form.deliveryMode} onChange={(event) => setForm((current) => ({ ...current, deliveryMode: event.target.value }))}>
            <option value="RAW">خودمدیریتی</option>
            <option value="MANAGED">مدیریت‌شده</option>
          </select>
        </FormField>
        <FormField id="plan-catalog" label="Catalog Size / Region">
          <select id="plan-catalog" value={form.catalogItemId} onChange={(event) => selectCatalog(event.target.value)} required>
            <option value="">انتخاب کنید</option>
            {catalogItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.regionCode} / {item.sizeCode} · {item.vcpu ?? "—"} vCPU · {item.ramMb ?? "—"} MB · {item.available ? toman(item.finalPriceRial) : "ناموجود"}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="plan-image" label="Image">
          <select id="plan-image" value={form.imageCode} onChange={(event) => setForm((current) => ({ ...current, imageCode: event.target.value }))} required>
            <option value="">انتخاب کنید</option>
            {(selectedCatalog?.compatibleImageCodes ?? []).map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </FormField>
        {selectedCatalog ? (
          <p style={{ fontSize: 13 }}>
            منابع Read-only: {selectedCatalog.vcpu ?? "—"} vCPU · {selectedCatalog.ramMb ?? "—"} MB RAM · {selectedCatalog.diskGb ?? "—"} GB
            <br />
            قیمت پایه: {toman(selectedCatalog.basePriceRial)} · قیمت نهایی: {toman(selectedCatalog.finalPriceRial)}
          </p>
        ) : null}
        <FormField id="plan-delivery" label="زمان تحویل تقریبی (دقیقه)">
          <input id="plan-delivery" type="number" min={1} value={form.deliveryEstimateMinutes} onChange={(event) => setForm((current) => ({ ...current, deliveryEstimateMinutes: event.target.value }))} required />
        </FormField>
        <FormField id="plan-sort" label="ترتیب نمایش">
          <input id="plan-sort" type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} />
        </FormField>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
          فعال
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.parchinIncluded} onChange={(event) => setForm((current) => ({ ...current, parchinIncluded: event.target.checked }))} />
          پرچین پایه
        </label>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
