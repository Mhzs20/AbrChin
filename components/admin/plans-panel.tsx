"use client";

import { Fragment, useMemo, useState } from "react";

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
  productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
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
  skuMarkupBasisPoints: number | null;
  basePriceRial: string | null;
  finalPriceRial: string | null;
  billingPolicy: BillingPolicyRow | null;
  pendingBillingPolicy: string | null;
  providerBillingContract: ProviderBillingContractRow | null;
};

type BillingPolicyRow = {
  id: string;
  version: number;
  scope: string;
  availability: "HOURLY_ONLY" | "DAILY_ONLY" | "HOURLY_AND_DAILY";
  defaultCadence: "HOURLY" | "DAILY";
  displayMode: "HOURLY" | "DAILY" | "BOTH";
  hourlyMinimumCreditHours: number;
  dailyMinimumCreditDays: number;
  hourlyGracePeriods: number;
  dailyGracePeriods: number;
  lowBalanceThresholdPeriods: number;
  effectiveFrom: string;
};

type ProviderBillingContractRow = {
  status: "VERIFIED" | "UNVERIFIED" | "REVOKED" | "INVALID";
  source: string;
  version: number;
  effectiveFrom: string;
  unverifiedFields: string[];
};

type CatalogRow = {
  id: string;
  provider: string;
  source: string;
  productKind: "CLOUD_SERVER" | "READY_INSTANT_SERVER";
  regionCode: string;
  sizeCode: string;
  compatibleImageCodes: string[];
  vcpu: number | null;
  ramMb: number | null;
  diskGb: number | null;
  available: boolean;
  providerMarkupBasisPoints: number | null;
  productMarkupBasisPoints: number;
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
  publicationStatus: "DRAFT",
  skuMarkupPercent: "",
  instantDelivery: false,
  displayDuringProviderOutage: true,
  sortOrder: "0",
  productKind: "CLOUD_SERVER",
};

const emptyManualForm = {
  code: "",
  title: "",
  description: "",
  externalPlanId: "",
  regionCode: "",
  imageAssetId: "",
  imageCode: "Ubuntu Linux",
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
  offerSource: "MANUAL_ADMIN",
};

const emptyBillingForm = {
  availability: "HOURLY_ONLY" as
    | "HOURLY_ONLY"
    | "DAILY_ONLY"
    | "HOURLY_AND_DAILY",
  defaultCadence: "HOURLY" as "HOURLY" | "DAILY",
  displayMode: "BOTH" as "HOURLY" | "DAILY" | "BOTH",
  hourlyMinimumCreditHours: "24",
  dailyMinimumCreditDays: "1",
  hourlyGracePeriods: "24",
  dailyGracePeriods: "3",
  lowBalanceThresholdPeriods: "3",
  effectiveFrom: "",
  changeReason: "",
};

function toman(value: string | null) {
  return value ? `${(BigInt(value) / 10n).toLocaleString("fa-IR")} تومان` : "نامعتبر";
}

const PAGE_SIZE = 20;

function publicationLabel(status: string) {
  if (status === "PUBLISHED") return "منتشر";
  if (status === "DRAFT") return "پیش‌نویس";
  if (status === "PAUSED") return "متوقف";
  if (status === "ARCHIVED") return "بایگانی";
  return status;
}

function publicationTone(status: string): "success" | "warning" | "neutral" | "danger" | "info" {
  if (status === "PUBLISHED") return "success";
  if (status === "DRAFT") return "warning";
  if (status === "PAUSED") return "danger";
  return "neutral";
}

function sourceLabel(source: string | null) {
  if (source === "MANUAL_ADMIN") return "دستی ابرچین";
  if (source === "MANUAL_API_BACKED") return "دستی+API";
  if (source === "PREPROVISIONED_INVENTORY") return "موجودی واقعی";
  return "کاتالوگ API";
}

function providerLabel(provider: string) {
  if (provider === "ARVAN") return "Arvan";
  if (provider === "PARSPACK") return "ParsPack";
  return provider;
}

function markupBasisPointsFromPercent(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const basisPoints =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0") || "0", 10);
  return Number.isSafeInteger(basisPoints) && basisPoints <= 100_000
    ? basisPoints
    : null;
}

function previewCatalogPrice(
  item: CatalogRow | null,
  skuMarkupPercent: string,
): { finalPriceRial: string; markupAmountRial: string; markupBasisPoints: number } | null {
  if (!item?.basePriceRial || item.providerMarkupBasisPoints == null) return null;
  const skuMarkupBasisPoints = markupBasisPointsFromPercent(skuMarkupPercent);
  if (skuMarkupPercent.trim() && skuMarkupBasisPoints == null) return null;
  const markupBasisPoints =
    item.providerMarkupBasisPoints +
    (skuMarkupBasisPoints ?? item.productMarkupBasisPoints);
  const basePriceRial = BigInt(item.basePriceRial);
  const markupAmountRial =
    (basePriceRial * BigInt(markupBasisPoints) + 9_999n) / 10_000n;
  return {
    finalPriceRial: (basePriceRial + markupAmountRial).toString(),
    markupAmountRial: markupAmountRial.toString(),
    markupBasisPoints,
  };
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
  const [inventoryUsername, setInventoryUsername] = useState("root");
  const [inventorySecret, setInventorySecret] = useState("");
  const [inventoryReason, setInventoryReason] = useState("");
  const [billingPlan, setBillingPlan] = useState<PlanRow | null>(null);
  const [billingForm, setBillingForm] = useState(emptyBillingForm);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const selectedCatalog = useMemo(
    () => catalogItems.find((item) => item.id === form.catalogItemId) ?? null,
    [catalogItems, form.catalogItemId],
  );
  const selectedPreview = useMemo(
    () => previewCatalogPrice(selectedCatalog, form.skuMarkupPercent),
    [form.skuMarkupPercent, selectedCatalog],
  );

  const filteredPlans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialPlans.filter((plan) => {
      if (statusFilter !== "ALL" && plan.publicationStatus !== statusFilter) {
        return false;
      }
      if (providerFilter !== "ALL" && plan.provider !== providerFilter) {
        return false;
      }
      if (!q) return true;
      return (
        plan.title.toLowerCase().includes(q) ||
        plan.code.toLowerCase().includes(q) ||
        plan.regionCode.toLowerCase().includes(q) ||
        (plan.externalPlanId ?? "").toLowerCase().includes(q)
      );
    });
  }, [initialPlans, providerFilter, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredPlans.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagePlans = filteredPlans.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  function openPlanEdit(plan: PlanRow) {
    if (
      plan.catalogSource === "MANUAL_API_BACKED" ||
      plan.catalogSource === "MANUAL_ADMIN"
    ) {
      setManualEditing(plan);
      setManualForm({
        ...emptyManualForm,
        code: plan.code,
        title: plan.title,
        description: plan.description ?? "",
        externalPlanId: plan.externalPlanId ?? "",
        regionCode: plan.regionCode,
        imageAssetId: plan.imageAssetId ?? "",
        imageCode: plan.imageCode,
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
        offerSource: plan.catalogSource ?? "MANUAL_API_BACKED",
      });
      setError("");
      setManualOpen(true);
      return;
    }
    openEdit(plan);
  }

  function openCreate() {
    const first = catalogItems.find((item) => item.available && item.finalPriceRial);
    setEditing(null);
    setForm({
      ...emptyForm,
      catalogItemId: first?.id ?? "",
      imageCode: first?.compatibleImageCodes[0] ?? "",
      productKind: first?.productKind ?? "CLOUD_SERVER",
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
      publicationStatus: plan.publicationStatus,
      skuMarkupPercent:
        plan.skuMarkupBasisPoints == null
          ? ""
          : String(plan.skuMarkupBasisPoints / 100),
      instantDelivery: plan.instantDelivery,
      displayDuringProviderOutage: plan.displayDuringProviderOutage,
      sortOrder: String(plan.sortOrder),
      productKind: plan.productKind,
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
      productKind: item?.productKind ?? current.productKind,
    }));
  }

  function openBillingPolicy(plan: PlanRow) {
    const policy = plan.billingPolicy;
    setBillingPlan(plan);
    setBillingForm({
      availability: policy?.availability ?? "HOURLY_ONLY",
      defaultCadence: policy?.defaultCadence ?? "HOURLY",
      displayMode: policy?.displayMode ?? "BOTH",
      hourlyMinimumCreditHours: String(
        policy?.hourlyMinimumCreditHours ?? 24,
      ),
      dailyMinimumCreditDays: String(
        policy?.dailyMinimumCreditDays ?? 1,
      ),
      hourlyGracePeriods: String(policy?.hourlyGracePeriods ?? 24),
      dailyGracePeriods: String(policy?.dailyGracePeriods ?? 3),
      lowBalanceThresholdPeriods: String(
        policy?.lowBalanceThresholdPeriods ?? 3,
      ),
      effectiveFrom: "",
      changeReason: "",
    });
    setError("");
  }

  async function submitBillingPolicy() {
    if (!billingPlan) return;
    const effectiveFrom = new Date(billingForm.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      setError("زمان شروع اثر معتبر و الزامی است.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/infrastructure/plans/${billingPlan.id}/billing-policy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            ...billingForm,
            hourlyMinimumCreditHours: Number(
              billingForm.hourlyMinimumCreditHours,
            ),
            dailyMinimumCreditDays: Number(
              billingForm.dailyMinimumCreditDays,
            ),
            hourlyGracePeriods: Number(
              billingForm.hourlyGracePeriods,
            ),
            dailyGracePeriods: Number(
              billingForm.dailyGracePeriods,
            ),
            lowBalanceThresholdPeriods: Number(
              billingForm.lowBalanceThresholdPeriods,
            ),
            effectiveFrom: effectiveFrom.toISOString(),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(
          typeof data.error === "string"
            ? data.error
            : "ذخیره Billing Policy ممکن نشد.",
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
      const inventoryId =
        data?.inventory && typeof data.inventory.id === "string"
          ? data.inventory.id
          : "";
      if (!inventoryId) {
        setError("شناسه موجودی ثبت‌شده دریافت نشد.");
        return;
      }
      const credentialResponse = await fetch(
        `/api/admin/infrastructure/preprovisioned-inventory/${inventoryId}/credential`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            username: inventoryUsername,
            secret: inventorySecret,
            reason: inventoryReason,
          }),
        },
      );
      const credentialData = await credentialResponse.json();
      if (!credentialResponse.ok) {
        setError(
          typeof credentialData.error === "string"
            ? credentialData.error
            : "ثبت Credential امن موجودی ممکن نشد.",
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
      <p style={{ marginTop: 0, color: "var(--product-muted)" }}>
        اینجا SKU فروش ساخته می‌شود: از کاتالوگ Arvan/ParsPack انتخاب → Markup →
        Draft → Published. تا Published نشود مشتری نمی‌بیند. چینش فروشگاهی فقط
        ترتیب نمایش همان SKUهای منتشرشده را تنظیم می‌کند.
      </p>
      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="product-btn product-btn--primary" onClick={openCreate}>
          ساخت Draft از کاتالوگ Provider
        </button>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          onClick={() => {
            const firstRegion = manualOptions.regions.find((region) => region.saleEnabled);
            setManualForm({
              ...emptyManualForm,
              regionCode: "abrchin",
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(180px, 2fr) repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13 }}>جست‌وجو</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="عنوان، کد، Region…"
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13 }}>وضعیت انتشار</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">همه</option>
            <option value="PUBLISHED">منتشر</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="PAUSED">متوقف</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13 }}>منبع</span>
          <select
            value={providerFilter}
            onChange={(event) => {
              setProviderFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">همه</option>
            <option value="ARVAN">Arvan</option>
            <option value="PARSPACK">ParsPack</option>
          </select>
        </label>
      </div>

      <p style={{ margin: "0 0 8px", color: "var(--product-muted)", fontSize: 13 }}>
        {filteredPlans.length.toLocaleString("fa-IR")} SKU · صفحه{" "}
        {safePage.toLocaleString("fa-IR")} از {totalPages.toLocaleString("fa-IR")}
      </p>

      {pagePlans.length === 0 ? (
        <p className="product-muted">SKUای با این فیلتر پیدا نشد.</p>
      ) : (
        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>عنوان</th>
                <th>وضعیت</th>
                <th>منبع</th>
                <th>Region</th>
                <th>منابع</th>
                <th>قیمت فروش</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {pagePlans.map((plan) => (
                <Fragment key={plan.id}>
                  <tr>
                    <td>
                      <strong>{plan.title}</strong>
                      <br />
                      <span className="product-tech">{plan.code}</span>
                      {plan.catalogMappingStatus !== "MAPPED" ? (
                        <>
                          <br />
                          <span className="product-muted">بدون Mapping</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`product-badge product-badge--${publicationTone(plan.publicationStatus)}`}
                      >
                        {publicationLabel(plan.publicationStatus)}
                      </span>
                    </td>
                    <td>
                      {providerLabel(plan.provider)} · {sourceLabel(plan.catalogSource)}
                    </td>
                    <td>
                      <span className="product-tech">{plan.regionCode}</span>
                    </td>
                    <td>
                      {String(plan.vcpu ?? "—")} vCPU / {String(plan.ramGb ?? "—")}{" "}
                      GB / {String(plan.storageGb ?? "—")} GB
                    </td>
                    <td>
                      {plan.finalPriceRial ? toman(plan.finalPriceRial) : "نیازمند بررسی"}
                      {plan.skuMarkupBasisPoints != null ? (
                        <>
                          <br />
                          <span className="product-muted">
                            Markup {(plan.skuMarkupBasisPoints / 100).toLocaleString("fa-IR")}٪
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button
                          type="button"
                          className="product-btn product-btn--quiet"
                          onClick={() => openPlanEdit(plan)}
                        >
                          ویرایش
                        </button>
                        {plan.productKind === "CLOUD_SERVER" ? (
                          <button
                            type="button"
                            className="product-btn product-btn--quiet"
                            onClick={() => openBillingPolicy(plan)}
                          >
                            Billing
                          </button>
                        ) : null}
                        {plan.catalogSource === "PREPROVISIONED_INVENTORY" ? (
                          <button
                            type="button"
                            className="product-btn product-btn--primary"
                            onClick={() => {
                              setInventoryPlan(plan);
                              setInventoryResourceId("");
                              setInventoryUsername("root");
                              setInventorySecret("");
                              setInventoryReason("");
                              setError("");
                            }}
                          >
                            Resource
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="product-btn product-btn--quiet"
                          onClick={() =>
                            setExpandedId((current) =>
                              current === plan.id ? null : plan.id,
                            )
                          }
                        >
                          {expandedId === plan.id ? "بستن جزئیات" : "جزئیات"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === plan.id ? (
                    <tr>
                      <td colSpan={7}>
                        <div
                          style={{
                            display: "grid",
                            gap: 4,
                            fontSize: 13,
                            color: "var(--product-muted)",
                          }}
                        >
                          <div>
                            هزینه Provider:{" "}
                            {plan.basePriceRial ? toman(plan.basePriceRial) : "—"}
                          </div>
                          <div>
                            موجودی/واحد:{" "}
                            {plan.catalogSource === "PREPROVISIONED_INVENTORY"
                              ? plan.availableInventory.toLocaleString("fa-IR")
                              : plan.catalogSource === "MANUAL_ADMIN"
                                ? (plan.manualAvailableUnits ?? 0).toLocaleString(
                                    "fa-IR",
                                  )
                                : "—"}
                          </div>
                          {plan.billingPolicy ? (
                            <div>
                              Billing: {plan.billingPolicy.availability} /{" "}
                              {plan.billingPolicy.defaultCadence}
                            </div>
                          ) : null}
                          {plan.pendingBillingPolicy ? (
                            <div>
                              تغییر Billing از{" "}
                              {new Date(plan.pendingBillingPolicy).toLocaleString(
                                "fa-IR",
                              )}
                            </div>
                          ) : null}
                          {plan.providerBillingContract ? (
                            <div>
                              قرارداد: {plan.providerBillingContract.status} ·{" "}
                              {plan.providerBillingContract.source} · v
                              {plan.providerBillingContract.version}
                              {plan.providerBillingContract.unverifiedFields.length
                                ? ` · تأییدنشده: ${plan.providerBillingContract.unverifiedFields.join(", ")}`
                                : ""}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="product-btn product-btn--quiet"
          disabled={safePage <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          قبلی
        </button>
        <span className="product-muted">
          صفحه {safePage.toLocaleString("fa-IR")} /{" "}
          {totalPages.toLocaleString("fa-IR")}
        </span>
        <button
          type="button"
          className="product-btn product-btn--quiet"
          disabled={safePage >= totalPages}
          onClick={() =>
            setPage((current) => Math.min(totalPages, current + 1))
          }
        >
          بعدی
        </button>
      </div>
      <ConfirmDialog
        open={open}
        title={editing ? "ویرایش SKU" : "ساخت SKU پیش‌نویس"}
        confirmLabel={editing ? "ذخیره تغییرات" : "ساخت Draft"}
        loading={loading}
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      >
        <FormField id="plan-product-kind" label="مسیر محصول از Catalog">
          <select
            id="plan-product-kind"
            value={form.productKind}
            disabled
            onChange={() => undefined}
          >
            <option value="CLOUD_SERVER">سرور ابری از Catalog</option>
            <option value="READY_INSTANT_SERVER">سرور فوری از Catalog</option>
          </select>
        </FormField>
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
            Provider: {selectedCatalog.provider} · نوع: {selectedCatalog.productKind === "READY_INSTANT_SERVER" ? "سرور فوری" : "سرور ابری"}
            <br />
            منابع Read-only: {selectedCatalog.vcpu ?? "—"} vCPU · {selectedCatalog.ramMb ?? "—"} MB RAM · {selectedCatalog.diskGb ?? "—"} GB
            <br />
            قیمت پایه: {toman(selectedCatalog.basePriceRial)} · Markup Provider: {selectedCatalog.providerMarkupBasisPoints == null ? "تنظیم نشده" : `${selectedCatalog.providerMarkupBasisPoints / 100}%`}
            <br />
            {selectedPreview
              ? `Markup اعمال‌شده: ${selectedPreview.markupBasisPoints / 100}% · مبلغ Markup: ${toman(selectedPreview.markupAmountRial)} · پیش‌نمایش فروش زیرساخت: ${toman(selectedPreview.finalPriceRial)}`
              : "برای پیش‌نمایش، قیمت و Markup معتبر Provider لازم است."}
          </p>
        ) : null}
        <FormField id="plan-delivery" label="زمان تحویل تقریبی (دقیقه)">
          <input id="plan-delivery" type="number" min={1} value={form.deliveryEstimateMinutes} onChange={(event) => setForm((current) => ({ ...current, deliveryEstimateMinutes: event.target.value }))} required />
        </FormField>
        <FormField id="plan-sku-markup" label="افزایش اختصاصی SKU (درصد، اختیاری)">
          <input
            id="plan-sku-markup"
            inputMode="decimal"
            min="0"
            max="1000"
            value={form.skuMarkupPercent}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                skuMarkupPercent: event.target.value,
              }))
            }
            placeholder="استفاده از افزایش پیش‌فرض محصول"
          />
        </FormField>
        <FormField id="plan-sort" label="ترتیب نمایش">
          <input id="plan-sort" type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} />
        </FormField>
        {editing ? (
          <FormField id="plan-publication" label="وضعیت انتشار">
            <select
              id="plan-publication"
              value={form.publicationStatus}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  publicationStatus: event.target.value,
                }))
              }
            >
              <option value="DRAFT">Draft — بازبینی نشده</option>
              <option value="PUBLISHED">Published — قابل‌فروش</option>
              <option value="PAUSED">Paused — توقف فروش</option>
              <option value="ARCHIVED">Archived — بایگانی</option>
            </select>
          </FormField>
        ) : (
          <p className="product-tech">
            SKU جدید همیشه به‌شکل Draft ایجاد می‌شود؛ انتشار فقط در ویرایش بعدی و پس از بررسی Admin انجام می‌شود.
          </p>
        )}
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
        open={Boolean(billingPlan)}
        title={`Billing Policy — ${billingPlan?.title ?? ""}`}
        confirmLabel="ثبت نسخه جدید"
        loading={loading}
        onCancel={() => setBillingPlan(null)}
        onConfirm={submitBillingPolicy}
      >
        <p className="product-tech">
          این تغییر نسخه‌دار است و فقط Activationهای آینده را تغییر می‌دهد.
          Snapshot سرویس‌های فعال و Invoiceهای بسته‌شده دست‌نخورده می‌مانند.
        </p>
        <FormField id="billing-availability" label="Billing availability">
          <select
            id="billing-availability"
            value={billingForm.availability}
            onChange={(event) => {
              const availability = event.target.value as
                | "HOURLY_ONLY"
                | "DAILY_ONLY"
                | "HOURLY_AND_DAILY";
              setBillingForm((current) => ({
                ...current,
                availability,
                defaultCadence:
                  availability === "DAILY_ONLY"
                    ? "DAILY"
                    : availability === "HOURLY_ONLY"
                      ? "HOURLY"
                      : current.defaultCadence,
              }));
            }}
          >
            <option value="HOURLY_ONLY">فقط ساعتی</option>
            <option value="DAILY_ONLY">فقط روزانه</option>
            <option value="HOURLY_AND_DAILY">انتخاب ساعتی یا روزانه</option>
          </select>
        </FormField>
        <FormField id="billing-default-cadence" label="Cadence پیش‌فرض">
          <select
            id="billing-default-cadence"
            value={billingForm.defaultCadence}
            onChange={(event) =>
              setBillingForm((current) => ({
                ...current,
                defaultCadence: event.target.value as
                  | "HOURLY"
                  | "DAILY",
              }))
            }
            disabled={billingForm.availability !== "HOURLY_AND_DAILY"}
          >
            <option value="HOURLY">ساعتی</option>
            <option value="DAILY">روزانه</option>
          </select>
        </FormField>
        <FormField id="billing-display-mode" label="نمایش قیمت">
          <select
            id="billing-display-mode"
            value={billingForm.displayMode}
            onChange={(event) =>
              setBillingForm((current) => ({
                ...current,
                displayMode: event.target.value as
                  | "HOURLY"
                  | "DAILY"
                  | "BOTH",
              }))
            }
          >
            <option value="HOURLY">فقط تخمین ساعتی</option>
            <option value="DAILY">فقط تخمین روزانه</option>
            <option value="BOTH">هر دو تخمین</option>
          </select>
        </FormField>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
          <FormField id="billing-hourly-buffer" label="Buffer ساعتی (ساعت)">
            <input id="billing-hourly-buffer" type="number" min={1} value={billingForm.hourlyMinimumCreditHours} onChange={(event) => setBillingForm((current) => ({ ...current, hourlyMinimumCreditHours: event.target.value }))} />
          </FormField>
          <FormField id="billing-daily-buffer" label="Buffer روزانه (روز)">
            <input id="billing-daily-buffer" type="number" min={1} value={billingForm.dailyMinimumCreditDays} onChange={(event) => setBillingForm((current) => ({ ...current, dailyMinimumCreditDays: event.target.value }))} />
          </FormField>
          <FormField id="billing-hourly-grace" label="Grace ساعتی (Period)">
            <input id="billing-hourly-grace" type="number" min={0} value={billingForm.hourlyGracePeriods} onChange={(event) => setBillingForm((current) => ({ ...current, hourlyGracePeriods: event.target.value }))} />
          </FormField>
          <FormField id="billing-daily-grace" label="Grace روزانه (Period)">
            <input id="billing-daily-grace" type="number" min={0} value={billingForm.dailyGracePeriods} onChange={(event) => setBillingForm((current) => ({ ...current, dailyGracePeriods: event.target.value }))} />
          </FormField>
        </div>
        <FormField id="billing-low-balance" label="Low-balance threshold (Period)">
          <input id="billing-low-balance" type="number" min={1} value={billingForm.lowBalanceThresholdPeriods} onChange={(event) => setBillingForm((current) => ({ ...current, lowBalanceThresholdPeriods: event.target.value }))} />
        </FormField>
        <FormField id="billing-effective-from" label="زمان شروع اثر">
          <input id="billing-effective-from" type="datetime-local" value={billingForm.effectiveFrom} onChange={(event) => setBillingForm((current) => ({ ...current, effectiveFrom: event.target.value }))} required />
        </FormField>
        <FormField id="billing-change-reason" label="دلیل تغییر">
          <textarea id="billing-change-reason" rows={2} value={billingForm.changeReason} onChange={(event) => setBillingForm((current) => ({ ...current, changeReason: event.target.value }))} required />
        </FormField>
        <div className="product-tech" aria-live="polite">
          <strong>پیش‌نمایش اثر:</strong>{" "}
          {billingForm.availability === "HOURLY_AND_DAILY"
            ? "Customer بین تسویه ساعتی و روزانه یکی را انتخاب می‌کند"
            : billingForm.availability === "HOURLY_ONLY"
              ? "فقط Settlement ساعتی فعال می‌شود"
              : "فقط Settlement روزانه فعال می‌شود"}
          {`؛ نمایش ${billingForm.displayMode} مستقل از Cadence مالی است؛ اثر از ${billingForm.effectiveFrom ? new Date(billingForm.effectiveFrom).toLocaleString("fa-IR") : "زمان نامعتبر"}.`}
        </div>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={manualOpen}
        title={manualEditing ? "ویرایش ظرفیت دستی" : "افزودن سرور فوری"}
        confirmLabel={manualEditing ? "ذخیره تغییرات" : "ثبت ظرفیت"}
        loading={loading}
        onCancel={() => setManualOpen(false)}
        onConfirm={submitManual}
      >
        <p className="product-tech">
          SKU دستی ابرچین با موجودی عددی و تحویل Admin کار می‌کند. موجودی
          ازپیش‌ساخته فقط با Resource واقعی، Credential رمزگذاری‌شده و Health
          تازه قابل فروش است.
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
                  regionCode:
                    event.target.value === "MANUAL_ADMIN"
                      ? "abrchin"
                      : current.regionCode,
                  publish:
                    event.target.value === "PREPROVISIONED_INVENTORY"
                      ? false
                      : current.publish,
                }))
              }
            >
              <option value="MANUAL_ADMIN">SKU دستی و تحویل Admin</option>
              <option value="MANUAL_API_BACKED">دستی، متکی به API</option>
              <option value="PREPROVISIONED_INVENTORY">موجودی واقعی ازپیش‌ساخته</option>
            </select>
          </FormField>
        ) : null}
        <FormField id="manual-code" label="کد داخلی"><input id="manual-code" value={manualForm.code} onChange={(event) => setManualForm((current) => ({ ...current, code: event.target.value }))} disabled={Boolean(manualEditing)} required /></FormField>
        <FormField id="manual-title" label="عنوان"><input id="manual-title" value={manualForm.title} onChange={(event) => setManualForm((current) => ({ ...current, title: event.target.value }))} required /></FormField>
        <FormField id="manual-description" label="توضیحات"><textarea id="manual-description" rows={2} value={manualForm.description} onChange={(event) => setManualForm((current) => ({ ...current, description: event.target.value }))} /></FormField>
        {manualForm.offerSource === "MANUAL_ADMIN" ? (
          <>
            <FormField id="manual-region-code" label="کد موقعیت">
              <input id="manual-region-code" value={manualForm.regionCode} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, regionCode: event.target.value }))} required />
            </FormField>
            <FormField id="manual-image-code" label="سیستم‌عامل">
              <input id="manual-image-code" value={manualForm.imageCode} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, imageCode: event.target.value }))} required />
            </FormField>
          </>
        ) : (
          <>
        <FormField id="manual-external-plan" label="Plan ID واقعی Arvan"><input id="manual-external-plan" value={manualForm.externalPlanId} onChange={(event) => setManualForm((current) => ({ ...current, externalPlanId: event.target.value }))} disabled={Boolean(manualEditing)} required /></FormField>
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
          </>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <FormField id="manual-vcpu" label="vCPU"><input id="manual-vcpu" type="number" min={1} value={manualForm.vcpu} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, vcpu: event.target.value }))} /></FormField>
          <FormField id="manual-ram" label="RAM GB"><input id="manual-ram" type="number" min={1} value={manualForm.ramGb} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, ramGb: event.target.value }))} /></FormField>
          <FormField id="manual-storage" label="Storage GB"><input id="manual-storage" type="number" min={1} value={manualForm.storageGb} disabled={Boolean(manualEditing)} onChange={(event) => setManualForm((current) => ({ ...current, storageGb: event.target.value }))} /></FormField>
        </div>
        {manualForm.offerSource === "MANUAL_API_BACKED" ||
        manualForm.offerSource === "MANUAL_ADMIN" ? (
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
        <FormField id="inventory-username" label="نام کاربری تحویل">
          <input id="inventory-username" value={inventoryUsername} onChange={(event) => setInventoryUsername(event.target.value)} autoComplete="username" required />
        </FormField>
        <FormField id="inventory-secret" label="Password یکتای یک‌بارمصرف">
          <input id="inventory-secret" type="password" value={inventorySecret} onChange={(event) => setInventorySecret(event.target.value)} autoComplete="new-password" minLength={8} required />
        </FormField>
        <FormField id="inventory-reason" label="دلیل ثبت/بازبینی">
          <textarea id="inventory-reason" value={inventoryReason} onChange={(event) => setInventoryReason(event.target.value)} rows={2} required />
        </FormField>
        {error ? <p className="product-error">{error}</p> : null}
      </ConfirmDialog>
    </>
  );
}
