"use client";

import { useMemo, useState } from "react";

type Candidate = {
  id: string;
  provider: string;
  regionCode: string;
  sizeCode: string;
  sizeName: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  available: boolean;
  status: string;
  providerHourlyPriceIrr: string | null;
  title: string;
};

type SlotRow = {
  id?: string;
  catalogItemId: string;
  role: "PRIMARY" | "RESERVE";
  sortOrder: number;
  enabled: boolean;
  available?: boolean;
  provider?: string;
  regionCode?: string;
  sizeName?: string;
  vcpu?: number | null;
  ramGb?: number | null;
  title?: string;
};

type TierView = {
  tier: "NO" | "OSTOVAR" | "KAHKESHAN";
  label: string;
  description: string;
  primaryLimit: number;
  reserveLimit: number;
  availableCount: number;
  primary: SlotRow[];
  reserve: SlotRow[];
};

function formatRial(value: string | null | undefined) {
  if (!value) return "—";
  return BigInt(value).toLocaleString("fa-IR");
}

type CapacityRules = {
  ostovarMinVcpu: number;
  ostovarMinRamGb: number;
  ostovarMinDiskGb: number;
  kahkeshanMinVcpu: number;
  kahkeshanMinRamGb: number;
  kahkeshanMinDiskGb: number;
};

type PriceDisplay = {
  showHourlyPrice: boolean;
  showDailyPrice: boolean;
  showMonthlyPrice: boolean;
};

type TierPriceToman = { min: number; max: number | "" };

type SettingsView = {
  autoSuggestEnabled: boolean;
  lastAutoAppliedAt: string | null;
  capacityRules: CapacityRules;
  priceDisplay: PriceDisplay;
  assortmentStyle: "CHEAPEST" | "STRONGEST";
  priceBandsToman: {
    NO: TierPriceToman;
    OSTOVAR: TierPriceToman;
    KAHKESHAN: TierPriceToman;
  };
};

export function StorefrontAssortmentPanel({
  initialTiers,
  candidates,
  initialSettings,
}: {
  initialTiers: TierView[];
  candidates: Candidate[];
  initialSettings: SettingsView;
}) {
  const [tiers, setTiers] = useState(initialTiers);
  const [settings, setSettings] = useState(initialSettings);
  const [capacityDraft, setCapacityDraft] = useState<CapacityRules>(
    initialSettings.capacityRules,
  );
  const [priceDisplayDraft, setPriceDisplayDraft] = useState<PriceDisplay>(
    initialSettings.priceDisplay ?? {
      showHourlyPrice: true,
      showDailyPrice: true,
      showMonthlyPrice: true,
    },
  );
  const [assortmentStyleDraft, setAssortmentStyleDraft] = useState<
    "CHEAPEST" | "STRONGEST"
  >(initialSettings.assortmentStyle ?? "CHEAPEST");
  const [priceBandsDraft, setPriceBandsDraft] = useState(
    initialSettings.priceBandsToman ?? {
      NO: { min: 0, max: "" as const },
      OSTOVAR: { min: 0, max: "" as const },
      KAHKESHAN: { min: 0, max: "" as const },
    },
  );
  const [activeTier, setActiveTier] = useState<TierView["tier"]>("NO");
  const [draftPrimary, setDraftPrimary] = useState<string[]>(
    initialTiers[0]?.primary.map((row) => row.catalogItemId) ?? [],
  );
  const [draftReserve, setDraftReserve] = useState<string[]>(
    initialTiers[0]?.reserve.map((row) => row.catalogItemId) ?? [],
  );
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyServerState(payload: {
    tiers?: TierView[];
    settings?: SettingsView;
  }) {
    if (payload.tiers) {
      setTiers(payload.tiers);
      const refreshed =
        payload.tiers.find((tier) => tier.tier === activeTier) ??
        payload.tiers[0];
      if (refreshed) {
        setActiveTier(refreshed.tier);
        setDraftPrimary(refreshed.primary.map((row) => row.catalogItemId));
        setDraftReserve(refreshed.reserve.map((row) => row.catalogItemId));
      }
    }
    if (payload.settings) {
      setSettings(payload.settings);
      setCapacityDraft(payload.settings.capacityRules);
      if (payload.settings.priceDisplay) {
        setPriceDisplayDraft(payload.settings.priceDisplay);
      }
      if (payload.settings.assortmentStyle) {
        setAssortmentStyleDraft(payload.settings.assortmentStyle);
      }
      if (payload.settings.priceBandsToman) {
        setPriceBandsDraft(payload.settings.priceBandsToman);
      }
    }
  }

  const active = tiers.find((tier) => tier.tier === activeTier) ?? tiers[0];

  const selectedIds = useMemo(
    () => new Set([...draftPrimary, ...draftReserve]),
    [draftPrimary, draftReserve],
  );

  const filteredCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((item) => {
      if (providerFilter !== "ALL" && item.provider !== providerFilter) {
        return false;
      }
      if (selectedIds.has(item.id)) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.regionCode.toLowerCase().includes(q) ||
        item.sizeCode.toLowerCase().includes(q) ||
        item.sizeName.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q)
      );
    });
  }, [candidates, providerFilter, query, selectedIds]);

  function selectTier(tier: TierView["tier"]) {
    const next = tiers.find((item) => item.tier === tier);
    if (!next) return;
    setActiveTier(tier);
    setDraftPrimary(next.primary.map((row) => row.catalogItemId));
    setDraftReserve(next.reserve.map((row) => row.catalogItemId));
    setMessage(null);
    setError(null);
  }

  function addTo(role: "PRIMARY" | "RESERVE", catalogItemId: string) {
    if (role === "PRIMARY") {
      if (draftPrimary.length >= (active?.primaryLimit ?? 24)) {
        setError("حداکثر ۲۴ پلن اصلی مجاز است.");
        return;
      }
      setDraftPrimary((current) => [...current, catalogItemId]);
    } else {
      if (draftReserve.length >= (active?.reserveLimit ?? 12)) {
        setError("حداکثر ۱۲ پلن رزرو مجاز است.");
        return;
      }
      setDraftReserve((current) => [...current, catalogItemId]);
    }
    setError(null);
  }

  function removeFrom(role: "PRIMARY" | "RESERVE", catalogItemId: string) {
    if (role === "PRIMARY") {
      setDraftPrimary((current) =>
        current.filter((id) => id !== catalogItemId),
      );
    } else {
      setDraftReserve((current) =>
        current.filter((id) => id !== catalogItemId),
      );
    }
  }

  function move(role: "PRIMARY" | "RESERVE", catalogItemId: string, direction: -1 | 1) {
    const list = role === "PRIMARY" ? [...draftPrimary] : [...draftReserve];
    const index = list.indexOf(catalogItemId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(nextIndex, 0, item);
    if (role === "PRIMARY") setDraftPrimary(list);
    else setDraftReserve(list);
  }

  async function save() {
    if (!active) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const slots = [
        ...draftPrimary.map((catalogItemId, sortOrder) => ({
          catalogItemId,
          role: "PRIMARY" as const,
          sortOrder,
          enabled: true,
        })),
        ...draftReserve.map((catalogItemId, sortOrder) => ({
          catalogItemId,
          role: "RESERVE" as const,
          sortOrder,
          enabled: true,
        })),
      ];
      const response = await fetch(
        "/api/admin/infrastructure/storefront-assortment",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier: active.tier, slots }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        tiers?: TierView[];
        settings?: SettingsView;
      };
      if (!response.ok) {
        throw new Error(payload.error || "ذخیره انجام نشد.");
      }
      applyServerState(payload);
      setMessage(
        "چینش ذخیره شد. پیشنهاد خودکار خاموش شد تا ویرایش دستی شما حفظ شود.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "ذخیره ممکن نیست.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runAutoAction(
    action: "apply_suggestions" | "set_auto_suggest",
    enabled?: boolean,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/admin/infrastructure/storefront-assortment",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, enabled }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        tiers?: TierView[];
        settings?: SettingsView;
      };
      if (!response.ok) {
        throw new Error(payload.error || "عملیات انجام نشد.");
      }
      applyServerState(payload);
      if (action === "apply_suggestions") {
        setMessage(
          enabled
            ? "پیشنهاد اعمال شد و بعد از هر Sync دوباره به‌روز می‌شود."
            : "پیشنهاد اصلی و رزرو برای هر سه چینش اعمال شد.",
        );
      } else {
        setMessage(
          enabled
            ? "پیشنهاد خودکار روشن شد و چینش‌ها تازه پر شدند."
            : "پیشنهاد خودکار خاموش شد. از این به بعد فقط ویرایش دستی اعمال می‌شود.",
        );
      }
    } catch (autoError) {
      setError(
        autoError instanceof Error ? autoError.message : "عملیات ممکن نیست.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveCapacityRules() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        "/api/admin/infrastructure/storefront-assortment",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "set_capacity_rules",
            capacityRules: capacityDraft,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        tiers?: TierView[];
        settings?: SettingsView;
      };
      if (!response.ok) {
        throw new Error(payload.error || "ذخیره قواعد ظرفیت انجام نشد.");
      }
      applyServerState(payload);
      setMessage(
        "قواعد ظرفیت ذخیره شد. پیشنهاد خودکار بعدی بر همین حداقل‌ها چینش می‌چیند.",
      );
    } catch (capacityError) {
      setError(
        capacityError instanceof Error
          ? capacityError.message
          : "ذخیره قواعد ظرفیت ممکن نیست.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePriceBandsAndStyle() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(
        "/api/admin/infrastructure/storefront-assortment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_price_bands_style",
            assortmentStyle: assortmentStyleDraft,
            priceBandsToman: priceBandsDraft,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        tiers?: TierView[];
        settings?: SettingsView;
      };
      if (!response.ok) {
        throw new Error(payload.error || "ذخیره باند قیمت انجام نشد.");
      }
      applyServerState(payload);
      setMessage(
        payload.settings?.autoSuggestEnabled
          ? "باند قیمت و سبک چینش ذخیره شد و پیشنهاد خودکار با همین قواعد دوباره چیده شد."
          : "باند قیمت و سبک چینش ذخیره شد. ترتیب کارت‌ها روی سایت با سبک انتخابی است؛ برای بازچینی اسلات‌ها پیشنهاد خودکار را روشن کن یا یک‌بار پیشنهاد بده.",
      );
    } catch (bandsError) {
      setError(
        bandsError instanceof Error
          ? bandsError.message
          : "ذخیره باند قیمت ممکن نیست.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePriceDisplay() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(
        "/api/admin/infrastructure/storefront-assortment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_price_display",
            priceDisplay: priceDisplayDraft,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        tiers?: TierView[];
        settings?: SettingsView;
      };
      if (!response.ok) {
        throw new Error(payload.error || "ذخیره نمایش قیمت انجام نشد.");
      }
      applyServerState(payload);
      setMessage("نمایش قیمت ساعتی/روزانه/ماهانه روی سایت اعمال شد.");
    } catch (priceError) {
      setError(
        priceError instanceof Error
          ? priceError.message
          : "ذخیره نمایش قیمت ممکن نیست.",
      );
    } finally {
      setBusy(false);
    }
  }

  function rowLabel(catalogItemId: string) {
    const candidate = candidates.find((item) => item.id === catalogItemId);
    if (!candidate) return catalogItemId;
    return `${candidate.title} · ${candidate.provider} · ${candidate.regionCode}`;
  }

  return (
    <section className="admin-stack" style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          border: "1px solid var(--product-border, #ddd)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div>
          <strong>نمایش قیمت روی کارت سرور</strong>
          <p style={{ margin: "8px 0 0", color: "var(--product-muted)" }}>
            خرید واقعی همچنان دوره‌ای ماهانه است. اینجا فقط مشخص می‌کنی کدام
            قیمت‌ها روی کارت چینش دیده شوند. حداقل یکی باید روشن باشد.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {(
            [
              ["showHourlyPrice", "ساعتی"],
              ["showDailyPrice", "روزانه (ساعتی × ۲۴)"],
              ["showMonthlyPrice", "ماهانه"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={priceDisplayDraft[key]}
                onChange={(event) =>
                  setPriceDisplayDraft((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="product-btn"
          disabled={busy}
          onClick={() => void savePriceDisplay()}
        >
          ذخیره نمایش قیمت
        </button>
      </div>

      <div
        style={{
          border: "1px solid var(--product-border, #ddd)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div>
          <strong>پیشنهاد خودکار چینش</strong>
          <p style={{ margin: "8px 0 0", color: "var(--product-muted)" }}>
            وقتی روشن باشد، با سبک انتخاب‌شده (ارزان‌ترین / قوی‌ترین) و باند
            قیمت هر چینش، تا ۸ ایران + ۸ خارج پیشنهاد می‌کند. با ذخیرهٔ دستی،
            خودکار خاموش می‌شود تا ویرایش شما حفظ شود.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            وضعیت:{" "}
            <strong>
              {settings.autoSuggestEnabled ? "روشن" : "خاموش"}
            </strong>
            {settings.lastAutoAppliedAt
              ? ` · آخرین اعمال: ${new Date(
                  settings.lastAutoAppliedAt,
                ).toLocaleString("fa-IR")}`
              : ""}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="product-btn"
            disabled={busy}
            onClick={() => void runAutoAction("set_auto_suggest", true)}
          >
            روشن کردن پیشنهاد خودکار
          </button>
          <button
            type="button"
            className="product-btn product-btn--quiet"
            disabled={busy}
            onClick={() => void runAutoAction("set_auto_suggest", false)}
          >
            خاموش کردن
          </button>
          <button
            type="button"
            className="product-btn product-btn--quiet"
            disabled={busy}
            onClick={() => void runAutoAction("apply_suggestions", false)}
          >
            یک‌بار پیشنهاد بده (بدون روشن ماندن)
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--product-border, #ddd)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div>
          <strong>قواعد ظرفیت چینش</strong>
          <p style={{ margin: "8px 0 0", color: "var(--product-muted)" }}>
            باندها جدا هستند: حداقل استوار = سقف چینش نو؛ حداقل کهکشان = سقف
            استوار. پیشنهاد خودکار هرگز از چینش دیگر پر نمی‌کند. پرچین کارت‌ها:
            نو → شروع، استوار → فعال، کهکشان → پایدار.
          </p>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {(
            [
              ["ostovarMinVcpu", "استوار · حداقل vCPU"],
              ["ostovarMinRamGb", "استوار · حداقل RAM (GB)"],
              ["ostovarMinDiskGb", "استوار · حداقل Disk (GB)"],
              ["kahkeshanMinVcpu", "کهکشان · حداقل vCPU"],
              ["kahkeshanMinRamGb", "کهکشان · حداقل RAM (GB)"],
              ["kahkeshanMinDiskGb", "کهکشان · حداقل Disk (GB)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>{label}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={capacityDraft[key]}
                onChange={(event) =>
                  setCapacityDraft((current) => ({
                    ...current,
                    [key]: Number.parseInt(event.target.value || "0", 10) || 0,
                  }))
                }
                style={{ minHeight: 40 }}
              />
            </label>
          ))}
        </div>
        <div>
          <button
            type="button"
            className="product-btn"
            disabled={busy}
            onClick={() => void saveCapacityRules()}
          >
            ذخیره قواعد ظرفیت
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid var(--product-border, #ddd)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div>
          <strong>باند قیمت ماهانه و سبک چینش</strong>
          <p style={{ margin: "8px 0 0", color: "var(--product-muted)" }}>
            برای هر چینش حداقل و حداکثر قیمت ماهانه (تومان) تعیین کن. سقف خالی =
            بدون سقف. سبک چینش ترتیب پیشنهاد خودکار و چیدمان کارت‌ها روی سایت را
            مشخص می‌کند.
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, minWidth: 220 }}>
            <span style={{ fontSize: 13 }}>سبک چینش خودکار / سایت</span>
            <select
              value={assortmentStyleDraft}
              onChange={(event) =>
                setAssortmentStyleDraft(
                  event.target.value === "STRONGEST"
                    ? "STRONGEST"
                    : "CHEAPEST",
                )
              }
              style={{ minHeight: 40 }}
            >
              <option value="CHEAPEST">از ارزان‌ترین</option>
              <option value="STRONGEST">از قوی‌ترین</option>
            </select>
          </label>
        </div>
        {(
          [
            ["NO", "چینش نو"],
            ["OSTOVAR", "چینش استوار"],
            ["KAHKESHAN", "چینش کهکشان"],
          ] as const
        ).map(([tier, label]) => (
          <div
            key={tier}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              paddingTop: 4,
            }}
          >
            <strong style={{ gridColumn: "1 / -1", fontSize: 14 }}>
              {label} · قیمت ماهانه (تومان)
            </strong>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>حداقل</span>
              <input
                type="number"
                min={0}
                step={1}
                value={priceBandsDraft[tier].min}
                onChange={(event) =>
                  setPriceBandsDraft((current) => ({
                    ...current,
                    [tier]: {
                      ...current[tier],
                      min:
                        Number.parseInt(event.target.value || "0", 10) || 0,
                    },
                  }))
                }
                style={{ minHeight: 40 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>حداکثر (خالی = بدون سقف)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={priceBandsDraft[tier].max}
                placeholder="بدون سقف"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  setPriceBandsDraft((current) => ({
                    ...current,
                    [tier]: {
                      ...current[tier],
                      max:
                        raw === ""
                          ? ""
                          : Number.parseInt(raw, 10) || 0,
                    },
                  }));
                }}
                style={{ minHeight: 40 }}
              />
            </label>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="product-btn"
            disabled={busy}
            onClick={() => void savePriceBandsAndStyle()}
          >
            ذخیره باند قیمت و سبک چینش
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {tiers.map((tier) => (
          <button
            key={tier.tier}
            type="button"
            className={
              tier.tier === activeTier
                ? "product-btn"
                : "product-btn product-btn--quiet"
            }
            onClick={() => selectTier(tier.tier)}
          >
            {tier.label}
            <small style={{ marginInlineStart: 8 }}>
              {tier.availableCount.toLocaleString("fa-IR")} موجود
            </small>
          </button>
        ))}
      </div>

      {active ? (
        <>
          <div>
            <h2 style={{ margin: 0 }}>{active.label}</h2>
            <p style={{ marginTop: 8, color: "var(--product-muted)" }}>
              {active.description}
            </p>
            <p style={{ marginTop: 8 }}>
              موجودی قابل‌نمایش:{" "}
              <strong>
                {active.availableCount.toLocaleString("fa-IR")}
              </strong>
              {" · "}
              اصلی {draftPrimary.length.toLocaleString("fa-IR")}/
              {active.primaryLimit.toLocaleString("fa-IR")}
              {" · "}
              رزرو {draftReserve.length.toLocaleString("fa-IR")}/
              {active.reserveLimit.toLocaleString("fa-IR")}
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            <SlotList
              title="پلن‌های اصلی"
              ids={draftPrimary}
              labelFor={rowLabel}
              onRemove={(id) => removeFrom("PRIMARY", id)}
              onMove={(id, direction) => move("PRIMARY", id, direction)}
            />
            <SlotList
              title="پلن‌های رزرو"
              ids={draftReserve}
              labelFor={rowLabel}
              onRemove={(id) => removeFrom("RESERVE", id)}
              onMove={(id, direction) => move("RESERVE", id, direction)}
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="جستجو در کاتالوگ همگام‌شده"
              style={{ flex: "1 1 220px", minHeight: 40 }}
            />
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              style={{ minHeight: 40 }}
            >
              <option value="ALL">همه Providerها</option>
              <option value="ARVAN">Arvan</option>
              <option value="PARSPACK">ParsPack</option>
            </select>
            <button
              type="button"
              className="product-btn"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "در حال ذخیره…" : "ذخیره این چینش"}
            </button>
          </div>

          {message ? <p style={{ color: "var(--product-success, green)" }}>{message}</p> : null}
          {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

          <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto" }}>
            {filteredCandidates.slice(0, 120).map((item) => (
              <article
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: 12,
                  border: "1px solid var(--product-border, #ddd)",
                  borderRadius: 12,
                }}
              >
                <div>
                  <strong>{item.title}</strong>
                  <div style={{ fontSize: 13, color: "var(--product-muted)" }}>
                    {item.provider} · {item.regionCode} · {item.sizeName}
                    {" · "}
                    {item.vcpu ?? "—"} vCPU / {item.ramGb ?? "—"} GB
                    {" · "}
                    ساعتی {formatRial(item.providerHourlyPriceIrr)} ریال
                    {" · "}
                    {item.available ? "موجود" : "ناموجود"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    onClick={() => addTo("PRIMARY", item.id)}
                  >
                    اصلی
                  </button>
                  <button
                    type="button"
                    className="product-btn product-btn--quiet"
                    onClick={() => addTo("RESERVE", item.id)}
                  >
                    رزرو
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SlotList({
  title,
  ids,
  labelFor,
  onRemove,
  onMove,
}: {
  title: string;
  ids: string[];
  labelFor: (id: string) => string;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--product-border, #ddd)",
        borderRadius: 12,
        padding: 12,
        display: "grid",
        gap: 8,
      }}
    >
      <strong>
        {title} ({ids.length.toLocaleString("fa-IR")})
      </strong>
      {ids.length === 0 ? (
        <p style={{ margin: 0, color: "var(--product-muted)" }}>هنوز انتخاب نشده</p>
      ) : (
        ids.map((id) => (
          <div
            key={id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 13 }}>{labelFor(id)}</span>
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" className="product-btn product-btn--quiet" onClick={() => onMove(id, -1)}>
                ↑
              </button>
              <button type="button" className="product-btn product-btn--quiet" onClick={() => onMove(id, 1)}>
                ↓
              </button>
              <button type="button" className="product-btn product-btn--quiet" onClick={() => onRemove(id)}>
                حذف
              </button>
            </span>
          </div>
        ))
      )}
    </div>
  );
}
