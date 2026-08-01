"use client";

import { useMemo, useState } from "react";

import { ConfirmDialog, FormField } from "@/components/product";

type PlanRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  catalogItemId: string | null;
  catalogMappingStatus: string;
  imageCode: string;
  deliveryEstimateMinutes: number;
  active: boolean;
  publicationStatus: string;
  instantDelivery: boolean;
  displayDuringProviderOutage: boolean;
  provider: string;
  catalogSource: string | null;
  offerPriceValidUntil: string | null;
  availableInventory: number;
  regionCode: string;
  externalPlanId: string | null;
  manualAvailableUnits: number | null;
  manualPriceValidUntil: string | null;
  manualBasePriceRial: string | null;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  imageAssetId: string | null;
  sortOrder: number;
};

type CatalogRow = {
  id: string;
  provider: string;
  source: string;
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
  catalogItemId: "",
  imageCode: "",
  deliveryEstimateMinutes: "15",
  active: true,
  instantDelivery: false,
  displayDuringProviderOutage: true,
  sortOrder: "0",
  offerSource: "API_CATALOG",
  offerPriceValidUntil: "",
};

const emptyManualForm = {
  code: "",
  title: "",
  description: "",
  externalPlanId: "",
  regionCode: "",
  imageAssetId: "",
  vcpu: "2",
  ramGb: "4",
  storageGb: "50",
  availableUnits: "1",
  basePriceToman: "",
  priceValidUntil: "",
  deliveryEstimateMinutes: "15",
  instantDelivery: true,
  publish: false,
  sortOrder: "0",
  offerSource: "MANUAL_API_BACKED",
};

function toman(value: string | null) {
  return value ? `${(BigInt(value) / 10n).toLocaleString("fa-IR")} تومان` : "نامعتبر";
}

export function AdminPlansPanel({
  initialPlans,
  catalogItems,
  manualOptions,
}: {
  initialPlans: PlanRow[];
  catalogItems: CatalogRow[];
  manualOptions: {
    regions: Array<{ code: string; label: string; saleEnabled: boolean }>;
    images: Array<{
      id: string;
      regionCode: string;
      externalId: string;
      label: string;
    }>;
  };
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualEditing, setManualEditing] = useState<PlanRow | null>(null);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [inventoryPlan, setInventoryPlan] = useState<PlanRow | null>(null);
  const [inventoryResourceId, setInventoryResourceId] = useState("");
  const [inventoryReason, setInventoryReason] = useState("");
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
      catalogItemId: plan.catalogItemId ?? "",
      imageCode: plan.imageCode,
      deliveryEstimateMinutes: String(plan.deliveryEstimateMinutes),
      active: plan.active,
      instantDelivery: plan.instantDelivery,
      displayDuringProviderOutage: plan.displayDuringProviderOutage,
      sortOrder: String(plan.sortOrder),
      offerSource: plan.catalogSource ?? "API_CATALOG",
      offerPriceValidUntil: plan.offerPriceValidUntil
        ? new Date(plan.offerPriceValidUntil).toISOString().slice(0, 16)
        : "",
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
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
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

  async function submitManual() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        manualEditing?.catalogItemId
          ? `/api/admin/infrastructure/manual-catalog/${manualEditing.catalogItemId}`
          : "/api/admin/infrastructure/manual-catalog",
        {
        method: manualEditing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          ...manualForm,
          vcpu: Number(manualForm.vcpu),
          ramGb: Number(manualForm.ramGb),
          storageGb: Number(manualForm.storageGb),
          availableUnits: Number(manualForm.availableUnits),
          basePriceToman: Number(manualForm.basePriceToman),
          deliveryEstimateMinutes: Number(manualForm.deliveryEstimateMinutes),
          sortOrder: Number(manualForm.sortOrder),
        }),
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

  async function registerInventory() {
    if (!inventoryPlan) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        "/api/admin/infrastructure/preprovisioned-inventory",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            planId: inventoryPlan.id,
            providerResourceId: inventoryResourceId,
            reason: inventoryReason,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "ثبت موجودی ممکن نشد.",
        );
        return;
      }
      window.location.reload();
    } catch {
      setError("ارتباط برقرار نشد.");
    } finally {
      setLoading(false);
    }
  }

  const manualImages = manualOptions.images.filter(
    (image) => image.regionCode === manualForm.regionCode,
  );

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="product-btn product-btn--primary" onClick={openCreate}>
          انتشار از کاتالوگ آروان
        </button>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          onClick={() => {
            const firstRegion = manualOptions.regions.find((region) => region.saleEnabled);
            setManualForm({
              ...emptyManualForm,
              regionCode: firstRegion?.code ?? "",
              imageAssetId:
                manualOptions.images.find((image) => image.regionCode === firstRegion?.code)?.id ?? "",
            });
            setManualEditing(null);
            setError("");
            setManualOpen(true);
          }}
        >
          افزودن ظرفیت دستی
        </button>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {initialPlans.map((plan) => (
          <li key={plan.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>
              {plan.title} <span className="product-tech">({plan.code})</span>
              {plan.catalogMappingStatus !== "MAPPED" ? " · بدون Mapping" : ""}
              {` · ${plan.publicationStatus}`}
              {plan.catalogSource === "MANUAL_API_BACKED"
                ? " · دستی متکی به API"
                : plan.catalogSource === "PREPROVISIONED_INVENTORY"
                  ? ` · موجودی واقعی: ${plan.availableInventory.toLocaleString("fa-IR")}`
                  : " · API Catalog"}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
            {plan.catalogSource === "PREPROVISIONED_INVENTORY" ? (
              <button
                type="button"
                className="product-btn product-btn--primary"
                onClick={() => {
                  setInventoryPlan(plan);
                  setInventoryResourceId("");
                  setInventoryReason("");
                  setError("");
                }}
              >
                ثبت Resource واقعی
              </button>
            ) : null}
            <button
              type="button"
              className="product-btn product-btn--quiet"
              onClick={() => {
                if (plan.catalogSource === "MANUAL_API_BACKED") {
                  setManualEditing(plan);
                  setManualForm({
                    ...emptyManualForm,
                    code: plan.code,
                    title: plan.title,
                    description: plan.description ?? "",
                    externalPlanId: plan.externalPlanId ?? "",
                    regionCode: plan.regionCode,
                    imageAssetId: plan.imageAssetId ?? "",
                    vcpu: String(plan.vcpu ?? 1),
                    ramGb: String(plan.ramGb ?? 1),
                    storageGb: String(plan.storageGb ?? 1),
                    availableUnits: String(plan.manualAvailableUnits ?? 0),
                    basePriceToman: plan.manualBasePriceRial
                      ? String(BigInt(plan.manualBasePriceRial) / 10n)
                      : "",
                    priceValidUntil: plan.manualPriceValidUntil
                      ? new Date(plan.manualPriceValidUntil).toISOString().slice(0, 16)
                      : "",
                    instantDelivery: plan.instantDelivery,
                    publish: plan.publicationStatus === "PUBLISHED",
                    sortOrder: String(plan.sortOrder),
                    offerSource:
                      plan.catalogSource ?? "MANUAL_API_BACKED",
                  });
                  setError("");
                  setManualOpen(true);
                } else {
                  openEdit(plan);
                }
              }}
            >
              ویرایش
            </button>
            </span>
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
        <p className="product-tech">
          سطح تحویل برای همه سرورها «همراه ابرچین» و پرچین پایه اجباری است.
        </p>
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
        <FormField id="plan-source" label="منبع فروش">
          <select
            id="plan-source"
            value={form.offerSource}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                offerSource: event.target.value,
                active:
                  event.target.value === "PREPROVISIONED_INVENTORY"
                    ? false
                    : current.active,
              }))
            }
          >
            <option value="API_CATALOG">API Catalog</option>
            <option value="MANUAL_API_BACKED">دستی، متکی به API</option>
            <option value="PREPROVISIONED_INVENTORY">موجودی واقعی ازپیش‌ساخته</option>
          </select>
        </FormField>
        {form.offerSource !== "API_CATALOG" ? (
          <FormField id="plan-offer-expiry" label="اعتبار قیمت تا">
            <input
              id="plan-offer-expiry"
              type="datetime-local"
              value={form.offerPriceValidUntil}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  offerPriceValidUntil: event.target.value,
                }))
              }
              required
            />
          </FormField>
        ) : null}
        <FormField id="plan-sort" label="ترتیب نمایش">
          <input id="plan-sort" type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} />
        </FormField>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
          فعال
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.instantDelivery} onChange={(event) => setForm((current) => ({ ...current, instantDelivery: event.target.checked }))} />
          تحویل فوری
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.displayDuringProviderOutage} onChange={(event) => setForm((current) => ({ ...current, displayDuringProviderOutage: event.target.checked }))} />
          نمایش آخرین اطلاعات سالم هنگام اختلال Provider
        </label>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={manualOpen}
        title={manualEditing ? "ویرایش ظرفیت دستی" : "افزودن ظرفیت دستی آروان"}
        confirmLabel={manualEditing ? "ذخیره تغییرات" : "ثبت ظرفیت"}
        loading={loading}
        onCancel={() => setManualOpen(false)}
        onConfirm={submitManual}
      >
        <p className="product-tech">
          منبع «دستی متکی به API» هنگام قطعی فقط نمایش داده می‌شود. فقط
          «موجودی واقعی» دارای Resource مشاهده‌شده و Health تازه می‌تواند بدون
          Revalidation خریداری شود.
        </p>
        {!manualEditing ? (
          <FormField id="manual-source" label="نوع منبع">
            <select
              id="manual-source"
              value={manualForm.offerSource}
              onChange={(event) =>
                setManualForm((current) => ({
                  ...current,
                  offerSource: event.target.value,
                  publish:
                    event.target.value === "PREPROVISIONED_INVENTORY"
                      ? false
                      : current.publish,
                }))
              }
            >
              <option value="MANUAL_API_BACKED">دستی، متکی به API</option>
              <option value="PREPROVISIONED_INVENTORY">موجودی واقعی ازپیش‌ساخته</option>
            </select>
          </FormField>
        ) : null}
        <FormField id="manual-code" label="کد داخلی"><input id="manual-code" value={manualForm.code} onChange={(event) => setManualForm((current) => ({ ...current, code: event.target.value }))} disabled={Boolean(manualEditing)} required /></FormField>
        <FormField id="manual-title" label="عنوان"><input id="manual-title" value={manualForm.title} onChange={(event) => setManualForm((current) => ({ ...current, title: event.target.value }))} required /></FormField>
        <FormField id="manual-description" label="توضیحات"><textarea id="manual-description" rows={2} value={manualForm.description} onChange={(event) => setManualForm((current) => ({ ...current, description: event.target.value }))} /></FormField>
        <FormField id="manual-external-plan" label="Plan ID واقعی آروان"><input id="manual-external-plan" value={manualForm.externalPlanId} onChange={(event) => setManualForm((current) => ({ ...current, externalPlanId: event.target.value }))} disabled={Boolean(manualEditing)} required /></FormField>
        <FormField id="manual-region" label="Region">
          <select id="manual-region" value={manualForm.regionCode} disabled={Boolean(manualEditing)} onChange={(event) => {
            const regionCode = event.target.value;
            setManualForm((current) => ({ ...current, regionCode, imageAssetId: manualOptions.images.find((image) => image.regionCode === regionCode)?.id ?? "" }));
          }} required>
            <option value="">انتخاب کنید</option>
            {manualOptions.regions.filter((region) => region.saleEnabled).map((region) => <option key={region.code} value={region.code}>{region.label} ({region.code})</option>)}
          </select>
        </FormField>
        <FormField id="manual-image" label="Image آخرین کاتالوگ سالم">
          <select id="manual-image" value={manualForm.imageAssetId} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, imageAssetId: event.target.value }))} required>
            <option value="">انتخاب کنید</option>
            {manualImages.map((image) => <option key={image.id} value={image.id}>{image.label}</option>)}
          </select>
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <FormField id="manual-vcpu" label="vCPU"><input id="manual-vcpu" type="number" min={1} value={manualForm.vcpu} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, vcpu: event.target.value }))} /></FormField>
          <FormField id="manual-ram" label="RAM GB"><input id="manual-ram" type="number" min={1} value={manualForm.ramGb} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, ramGb: event.target.value }))} /></FormField>
          <FormField id="manual-storage" label="Storage GB"><input id="manual-storage" type="number" min={1} value={manualForm.storageGb} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, storageGb: event.target.value }))} /></FormField>
        </div>
        {manualForm.offerSource === "MANUAL_API_BACKED" ? (
          <FormField id="manual-capacity" label="سقف مدیریتی (مجوز فروش هنگام قطعی نیست)"><input id="manual-capacity" type="number" min={1} value={manualForm.availableUnits} onChange={(event) => setManualForm((current) => ({ ...current, availableUnits: event.target.value }))} /></FormField>
        ) : null}
        <FormField id="manual-price" label="قیمت پایه ماهانه (تومان)"><input id="manual-price" type="number" min={1} value={manualForm.basePriceToman} onChange={(event) => setManualForm((current) => ({ ...current, basePriceToman: event.target.value }))} required /></FormField>
        <FormField id="manual-expiry" label="اعتبار قیمت تا"><input id="manual-expiry" type="datetime-local" value={manualForm.priceValidUntil} onChange={(event) => setManualForm((current) => ({ ...current, priceValidUntil: event.target.value }))} required /></FormField>
        <FormField id="manual-delivery" label="زمان تحویل (دقیقه)"><input id="manual-delivery" type="number" min={1} value={manualForm.deliveryEstimateMinutes} onChange={(event) => setManualForm((current) => ({ ...current, deliveryEstimateMinutes: event.target.value }))} /></FormField>
        <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={manualForm.instantDelivery} onChange={(event) => setManualForm((current) => ({ ...current, instantDelivery: event.target.checked }))} />تحویل فوری</label>
        <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={manualForm.publish} disabled={manualForm.offerSource === "PREPROVISIONED_INVENTORY" && !manualEditing} onChange={(event) => setManualForm((current) => ({ ...current, publish: event.target.checked }))} />همین حالا منتشر شود</label>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(inventoryPlan)}
        title="ثبت و بررسی Resource واقعی"
        confirmLabel="GET، Health Check و ثبت"
        loading={loading}
        onCancel={() => setInventoryPlan(null)}
        onConfirm={registerInventory}
      >
        <p className="product-tech">
          این عملیات فقط GET و TCP Health Check انجام می‌دهد؛ هیچ Resource جدیدی
          ساخته نمی‌شود.
        </p>
        <FormField id="inventory-resource" label="Provider Resource ID">
          <input id="inventory-resource" value={inventoryResourceId} onChange={(event) => setInventoryResourceId(event.target.value)} required />
        </FormField>
        <FormField id="inventory-reason" label="دلیل ثبت/بازبینی">
          <textarea id="inventory-reason" value={inventoryReason} onChange={(event) => setInventoryReason(event.target.value)} rows={2} required />
        </FormField>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
