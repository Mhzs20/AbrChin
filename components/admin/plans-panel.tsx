"use client";

import { useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

type PlanRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  deliveryMode: string;
  regionCode: string;
  sizeCode: string;
  imageCode: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  salePriceRial: string;
  renewalPriceRial: string | null;
  estimatedProviderCostRial: string;
  deliveryEstimateMinutes: number;
  parchinIncluded: boolean;
  active: boolean;
  sortOrder: number;
};

export function AdminPlansPanel({ initialPlans }: { initialPlans: PlanRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    code: "",
    title: "",
    description: "",
    deliveryMode: "RAW",
    regionCode: "",
    sizeCode: "",
    imageCode: "",
    vcpu: "",
    ramGb: "",
    storageGb: "",
    salePriceToman: "",
    renewalPriceToman: "",
    estimatedProviderCostToman: "",
    deliveryEstimateMinutes: "15",
    parchinIncluded: false,
    active: true,
    sortOrder: "0",
  });

  function openCreate() {
    setEditing(null);
    setForm({
      code: "",
      title: "",
      description: "",
      deliveryMode: "RAW",
      regionCode: "",
      sizeCode: "",
      imageCode: "",
      vcpu: "",
      ramGb: "",
      storageGb: "",
      salePriceToman: "",
      renewalPriceToman: "",
      estimatedProviderCostToman: "",
      deliveryEstimateMinutes: "15",
      parchinIncluded: false,
      active: true,
      sortOrder: "0",
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
      regionCode: plan.regionCode,
      sizeCode: plan.sizeCode,
      imageCode: plan.imageCode,
      vcpu: plan.vcpu == null ? "" : String(plan.vcpu),
      ramGb: plan.ramGb == null ? "" : String(plan.ramGb),
      storageGb: plan.storageGb == null ? "" : String(plan.storageGb),
      salePriceToman: String(Math.floor(Number(plan.salePriceRial) / 10)),
      renewalPriceToman: String(
        Math.floor(Number(plan.renewalPriceRial ?? plan.salePriceRial) / 10),
      ),
      estimatedProviderCostToman: String(Math.floor(Number(plan.estimatedProviderCostRial) / 10)),
      deliveryEstimateMinutes: String(plan.deliveryEstimateMinutes),
      parchinIncluded: plan.parchinIncluded,
      active: plan.active,
      sortOrder: String(plan.sortOrder),
    });
    setError("");
    setOpen(true);
  }

  async function submit() {
    setLoading(true);
    setError("");
    try {
      const payload = {
        ...form,
        salePriceToman: Number(form.salePriceToman),
        renewalPriceToman: Number(form.renewalPriceToman || form.salePriceToman),
        estimatedProviderCostToman: Number(form.estimatedProviderCostToman),
        vcpu: Number(form.vcpu),
        ramGb: Number(form.ramGb),
        storageGb: Number(form.storageGb),
        deliveryEstimateMinutes: Number(form.deliveryEstimateMinutes),
        sortOrder: Number(form.sortOrder),
      };
      const response = await fetch(
        editing ? `/api/admin/infrastructure/plans/${editing.id}` : "/api/admin/infrastructure/plans",
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
          <input
            id="plan-code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            disabled={Boolean(editing)}
            required
          />
        </FormField>
        <FormField id="plan-title" label="عنوان">
          <input id="plan-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
        </FormField>
        <FormField id="plan-desc" label="توضیحات">
          <textarea id="plan-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
        </FormField>
        <FormField id="plan-mode" label="سطح همراهی">
          <select id="plan-mode" value={form.deliveryMode} onChange={(e) => setForm((f) => ({ ...f, deliveryMode: e.target.value }))}>
            <option value="RAW">خودمدیریتی</option>
            <option value="MANAGED">مدیریت‌شده</option>
          </select>
        </FormField>
        <FormField id="plan-region" label="کد Region">
          <input id="plan-region" value={form.regionCode} onChange={(e) => setForm((f) => ({ ...f, regionCode: e.target.value }))} className="product-tech" />
        </FormField>
        <FormField id="plan-size" label="کد Size">
          <input id="plan-size" value={form.sizeCode} onChange={(e) => setForm((f) => ({ ...f, sizeCode: e.target.value }))} className="product-tech" />
        </FormField>
        <FormField id="plan-image" label="کد Image">
          <input id="plan-image" value={form.imageCode} onChange={(e) => setForm((f) => ({ ...f, imageCode: e.target.value }))} className="product-tech" />
        </FormField>
        <FormField id="plan-vcpu" label="vCPU نمایشی">
          <input id="plan-vcpu" type="number" min={1} value={form.vcpu} onChange={(e) => setForm((f) => ({ ...f, vcpu: e.target.value }))} required />
        </FormField>
        <FormField id="plan-ram" label="RAM (GB)">
          <input id="plan-ram" type="number" min={1} value={form.ramGb} onChange={(e) => setForm((f) => ({ ...f, ramGb: e.target.value }))} required />
        </FormField>
        <FormField id="plan-storage" label="فضا (GB)">
          <input id="plan-storage" type="number" min={1} value={form.storageGb} onChange={(e) => setForm((f) => ({ ...f, storageGb: e.target.value }))} required />
        </FormField>
        <FormField id="plan-sale" label="قیمت فروش (تومان)">
          <input id="plan-sale" type="number" min={1} value={form.salePriceToman} onChange={(e) => setForm((f) => ({ ...f, salePriceToman: e.target.value }))} required />
        </FormField>
        <FormField id="plan-renewal" label="قیمت تمدید ماهانه (تومان)">
          <input id="plan-renewal" type="number" min={1} value={form.renewalPriceToman} onChange={(e) => setForm((f) => ({ ...f, renewalPriceToman: e.target.value }))} required />
        </FormField>
        <FormField id="plan-cost" label="هزینه Provider (تومان)">
          <input id="plan-cost" type="number" min={1} value={form.estimatedProviderCostToman} onChange={(e) => setForm((f) => ({ ...f, estimatedProviderCostToman: e.target.value }))} required />
        </FormField>
        <FormField id="plan-delivery" label="زمان تحویل تقریبی (دقیقه)">
          <input id="plan-delivery" type="number" min={1} value={form.deliveryEstimateMinutes} onChange={(e) => setForm((f) => ({ ...f, deliveryEstimateMinutes: e.target.value }))} required />
        </FormField>
        <FormField id="plan-sort" label="ترتیب نمایش">
          <input id="plan-sort" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
        </FormField>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          فعال
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.parchinIncluded} onChange={(e) => setForm((f) => ({ ...f, parchinIncluded: e.target.checked }))} />
          پرچین در این پلن فعال است
        </label>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
