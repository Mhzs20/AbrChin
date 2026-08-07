"use client";

import {
  Calculator,
  Download,
  FileText,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SectionCard, StatusBadge } from "@/components/product";

type KpiView = "booked" | "recognized";
type AccountingTab =
  | "overview"
  | "sales"
  | "expenses"
  | "refunds"
  | "wallet"
  | "tax"
  | "reconciliation"
  | "journal";

type KpiTotals = {
  view: KpiView;
  grossBilledRial: string;
  taxRial: string;
  netSalesExclTaxRial: string;
  providerCogsRial: string;
  grossProfitRial: string;
  operatingExpenseRial: string;
  operatingProfitRial: string;
  effectiveMarginBps: number | null;
  grossProfitExact?: boolean;
};

type OrderRow = {
  orderId: string;
  paidAt: string | null;
  status: string;
  provider: string | null;
  productKind: string | null;
  regionCode: string | null;
  parchinLevel: string | null;
  termMonths: number;
  grossBilledRial: string;
  taxRial: string;
  netSalesExclTaxRial: string;
  providerCogsRial: string;
  grossProfitRial: string | null;
  effectiveMarginBps: number | null;
  quality: string | null;
  missingProviderCost: boolean;
};

type ExpenseRow = {
  id: string;
  date: string;
  amountRial: string;
  category: string;
  title: string;
  description: string | null;
  vendor: string | null;
  status: "DRAFT" | "POSTED" | "REVERSED";
  reversalReason: string | null;
};

type JournalEntry = {
  id: string;
  eventType: string;
  referenceType: string;
  referenceId: string;
  occurredAt: string;
  status: string;
  quality: string;
  lines: Array<{
    id: string;
    accountCode: string;
    debitRial: string;
    creditRial: string;
    description: string | null;
  }>;
};

const TABS: Array<{ id: AccountingTab; label: string }> = [
  { id: "overview", label: "خلاصه" },
  { id: "sales", label: "فروش" },
  { id: "expenses", label: "هزینه‌ها" },
  { id: "refunds", label: "بازگشت‌ها" },
  { id: "wallet", label: "کیف پول" },
  { id: "tax", label: "مالیات" },
  { id: "reconciliation", label: "تطبیق" },
  { id: "journal", label: "دفتر روزنامه" },
];

const RANGE_PRESETS = [
  { id: "today", label: "امروز" },
  { id: "7d", label: "۷ روز" },
  { id: "30d", label: "۳۰ روز" },
  { id: "this_month", label: "این ماه" },
  { id: "prev_month", label: "ماه قبل" },
  { id: "custom", label: "بازه سفارشی" },
] as const;

type RangePreset = (typeof RANGE_PRESETS)[number]["id"];

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function resolveRange(preset: RangePreset, customFrom: string, customTo: string) {
  const now = new Date();
  if (preset === "today") {
    return { from: startOfDay(now), to: endOfDay(now) };
  }
  if (preset === "7d") {
    const from = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    return { from, to: endOfDay(now) };
  }
  if (preset === "30d") {
    const from = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    return { from, to: endOfDay(now) };
  }
  if (preset === "this_month") {
    return {
      from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: endOfDay(now),
    };
  }
  if (preset === "prev_month") {
    const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
    return { from, to };
  }
  const from = customFrom ? startOfDay(new Date(customFrom)) : undefined;
  const to = customTo ? endOfDay(new Date(customTo)) : undefined;
  return { from, to };
}

function formatToman(rial: string | null | undefined) {
  if (rial == null || rial === "") return "—";
  try {
    const value = BigInt(rial);
    const negative = value < 0n;
    const toman = (negative ? -value : value) / 10n;
    return `${negative ? "−" : ""}${toman.toLocaleString("fa-IR")} تومان`;
  } catch {
    return "—";
  }
}

function bpsLabel(bps: number | null | undefined) {
  if (bps == null) return "—";
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction === 0
    ? `${whole.toLocaleString("fa-IR")}٪`
    : `${whole.toLocaleString("fa-IR")}٫${String(fraction).padStart(2, "0")}٪`;
}

function deltaLabel(current: string, previous: string | null | undefined) {
  if (!previous) return null;
  try {
    const cur = BigInt(current);
    const prev = BigInt(previous);
    const delta = cur - prev;
    if (delta === 0n) return "بدون تغییر نسبت به دوره قبل";
    const pct =
      prev === 0n
        ? null
        : Number((delta * 10_000n) / (prev < 0n ? -prev : prev)) / 100;
    const sign = delta > 0n ? "+" : "−";
    const abs = delta < 0n ? -delta : delta;
    return `${sign}${(abs / 10n).toLocaleString("fa-IR")} تومان${
      pct == null ? "" : ` (${sign}${Math.abs(pct).toLocaleString("fa-IR")}٪)`
    }`;
  } catch {
    return null;
  }
}

function categoryLabel(category: string) {
  const map: Record<string, string> = {
    GATEWAY_FEES: "کارمزد درگاه",
    SMS_EXPENSE: "پیامک",
    SUPPORT_OPERATIONS: "پشتیبانی",
    HOSTING_OPERATIONS: "عملیات میزبانی",
    MARKETING_EXPENSE: "بازاریابی",
    PAYROLL_CONTRACTOR: "پیمانکار/حقوق",
    OTHER_OPERATING_EXPENSE: "سایر",
  };
  return map[category] ?? category;
}

export function AccountingCenterPanel() {
  const [tab, setTab] = useState<AccountingTab>("overview");
  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [view, setView] = useState<KpiView>("booked");
  const [provider, setProvider] = useState("");
  const [productKind, setProductKind] = useState("");
  const [location, setLocation] = useState("");
  const [chinishTier, setChinishTier] = useState("");
  const [parchinLevel, setParchinLevel] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [dataQuality, setDataQuality] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [kpis, setKpis] = useState<KpiTotals | null>(null);
  const [previousKpis, setPreviousKpis] = useState<KpiTotals | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [needsReconciliation, setNeedsReconciliation] = useState(0);
  const [needsReconciliationAmount, setNeedsReconciliationAmount] =
    useState("0");
  const [ordersMissingCost, setOrdersMissingCost] = useState(0);
  const [dataCompletenessBps, setDataCompletenessBps] = useState(10_000);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [expenseForm, setExpenseForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amountToman: "",
    category: "OTHER_OPERATING_EXPENSE",
    title: "",
    vendor: "",
  });
  const [savingExpense, setSavingExpense] = useState(false);

  const queryString = useMemo(() => {
    const { from, to } = resolveRange(rangePreset, customFrom, customTo);
    const params = new URLSearchParams();
    if (from) params.set("from", from.toISOString());
    if (to) params.set("to", to.toISOString());
    params.set("view", view);
    if (provider) params.set("provider", provider);
    if (productKind) params.set("productKind", productKind);
    if (location.trim()) params.set("location", location.trim());
    if (chinishTier) params.set("chinishTier", chinishTier);
    if (parchinLevel) params.set("parchinLevel", parchinLevel);
    if (orderStatus) params.set("orderStatus", orderStatus);
    if (dataQuality) params.set("dataQuality", dataQuality);
    return params.toString();
  }, [
    chinishTier,
    customFrom,
    customTo,
    dataQuality,
    location,
    orderStatus,
    parchinLevel,
    productKind,
    provider,
    rangePreset,
    view,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewRes, expensesRes, journalRes] = await Promise.all([
        fetch(`/api/admin/accounting/overview?${queryString}`),
        fetch(`/api/admin/accounting/expenses?${queryString}`),
        fetch(`/api/admin/accounting/journal?${queryString}&take=80`),
      ]);
      const overviewBody = (await overviewRes.json()) as {
        error?: string;
        disclaimer?: string;
        overview?: {
          kpis: KpiTotals;
          rows: OrderRow[];
          needsReconciliationCount: number;
          needsReconciliationAmountRial?: string;
          ordersMissingCostSnapshot?: number;
          dataCompletenessBps?: number;
        };
        previousKpis?: KpiTotals | null;
      };
      if (!overviewRes.ok) {
        throw new Error(overviewBody.error ?? "خواندن خلاصه ممکن نشد.");
      }
      setDisclaimer(overviewBody.disclaimer ?? "");
      setKpis(overviewBody.overview?.kpis ?? null);
      setPreviousKpis(overviewBody.previousKpis ?? null);
      setOrders(overviewBody.overview?.rows ?? []);
      setNeedsReconciliation(
        overviewBody.overview?.needsReconciliationCount ?? 0,
      );
      setNeedsReconciliationAmount(
        overviewBody.overview?.needsReconciliationAmountRial ?? "0",
      );
      setOrdersMissingCost(
        overviewBody.overview?.ordersMissingCostSnapshot ?? 0,
      );
      setDataCompletenessBps(
        overviewBody.overview?.dataCompletenessBps ?? 10_000,
      );

      if (expensesRes.ok) {
        const body = (await expensesRes.json()) as { expenses?: ExpenseRow[] };
        setExpenses(body.expenses ?? []);
      }
      if (journalRes.ok) {
        const body = (await journalRes.json()) as { entries?: JournalEntry[] };
        setJournal(body.entries ?? []);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "خطا در بارگذاری.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const selectedOrder = useMemo(
    () => orders.find((row) => row.orderId === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  const refundOrders = useMemo(
    () => orders.filter((row) => row.status === "REFUNDED"),
    [orders],
  );

  const revenueMix = useMemo(() => {
    if (!kpis) return null;
    try {
      const net = BigInt(kpis.netSalesExclTaxRial);
      const cogs = BigInt(kpis.providerCogsRial);
      const opex = BigInt(kpis.operatingExpenseRial);
      const profit = BigInt(kpis.operatingProfitRial);
      const total =
        (net < 0n ? -net : net) +
        (cogs < 0n ? -cogs : cogs) +
        (opex < 0n ? -opex : opex) +
        (profit < 0n ? -profit : profit);
      if (total === 0n) return null;
      return {
        net: Number((net * 100n) / total),
        cogs: Number((cogs * 100n) / total),
        opex: Number((opex * 100n) / total),
        profit: Number((profit * 100n) / total),
      };
    } catch {
      return null;
    }
  }, [kpis]);

  async function createExpense() {
    setSavingExpense(true);
    setError("");
    try {
      const toman = expenseForm.amountToman.replace(/[^\d]/g, "");
      if (!toman || !expenseForm.title.trim()) {
        throw new Error("عنوان و مبلغ هزینه الزامی است.");
      }
      const response = await fetch("/api/admin/accounting/expenses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          date: new Date(expenseForm.date).toISOString(),
          amountRial: (BigInt(toman) * 10n).toString(),
          category: expenseForm.category,
          title: expenseForm.title,
          vendor: expenseForm.vendor || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "ثبت پیش‌نویس ممکن نشد.");
      setExpenseForm((current) => ({
        ...current,
        amountToman: "",
        title: "",
        vendor: "",
      }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت ممکن نشد.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function postExpense(id: string) {
    setSavingExpense(true);
    try {
      const response = await fetch(`/api/admin/accounting/expenses/${id}/post`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "ثبت نهایی ممکن نشد.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت نهایی ممکن نشد.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function reverseExpense(id: string) {
    const reason = window.prompt("دلیل برگشت هزینه؟");
    if (!reason || reason.trim().length < 3) return;
    setSavingExpense(true);
    try {
      const response = await fetch(
        `/api/admin/accounting/expenses/${id}/reverse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ reason }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "برگشت ممکن نشد.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "برگشت ممکن نشد.");
    } finally {
      setSavingExpense(false);
    }
  }

  function exportCsv() {
    window.location.href = `/api/admin/accounting/export?${queryString}&kind=orders`;
  }

  const kpiCards: Array<{
    key: keyof KpiTotals;
    label: string;
    tip: string;
  }> = [
    {
      key: "grossBilledRial",
      label: "فروش ناخالص",
      tip: "جمع درآمد زیرساخت + پرچین + افزونه قبل از تخفیف",
    },
    {
      key: "taxRial",
      label: "مالیات",
      tip: "VAT قابل پرداخت؛ در درآمد شناسایی‌شده لحاظ نمی‌شود",
    },
    {
      key: "netSalesExclTaxRial",
      label: "فروش خالص (بدون مالیات)",
      tip: "فروش ناخالص منهای تخفیف و بازگشت فروش",
    },
    {
      key: "providerCogsRial",
      label: "بهای تمام‌شده Provider",
      tip: "هزینه خرید زیرساخت و افزونه از ارائه‌دهنده",
    },
    {
      key: "grossProfitRial",
      label: "سود ناخالص",
      tip: "فروش خالص منهای بهای تمام‌شده",
    },
    {
      key: "operatingExpenseRial",
      label: "هزینه عملیاتی",
      tip: "هزینه‌های ثبت‌شده دستی و کارمزدها",
    },
    {
      key: "operatingProfitRial",
      label: "سود عملیاتی",
      tip: "سود ناخالص منهای هزینه عملیاتی",
    },
  ];

  return (
    <div className="accounting-center">
      <div className="accounting-disclaimer" role="note">
        {disclaimer ||
          "این گزارش سود و زیان عملیاتی/مدیریتی است و دفتر قانونی حسابداری ایران نیست."}
      </div>

      <div className="accounting-toolbar">
        <div className="accounting-range" role="group" aria-label="بازه زمانی">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={
                rangePreset === preset.id
                  ? "accounting-chip accounting-chip--active"
                  : "accounting-chip"
              }
              onClick={() => setRangePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {rangePreset === "custom" ? (
          <div className="accounting-custom-range">
            <label>
              از
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </label>
            <label>
              تا
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <div className="accounting-view-toggle" role="group">
          <button
            type="button"
            className={
              view === "booked"
                ? "accounting-chip accounting-chip--active"
                : "accounting-chip"
            }
            onClick={() => setView("booked")}
          >
            فروش ثبت‌شده
          </button>
          <button
            type="button"
            className={
              view === "recognized"
                ? "accounting-chip accounting-chip--active"
                : "accounting-chip"
            }
            onClick={() => setView("recognized")}
          >
            درآمد شناسایی‌شده (مدیریتی)
          </button>
        </div>

        <div className="accounting-filters">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            aria-label="Provider"
          >
            <option value="">همه Providerها</option>
            <option value="ARVAN">Arvan</option>
            <option value="PARSPACK">ParsPack</option>
          </select>
          <select
            value={productKind}
            onChange={(event) => setProductKind(event.target.value)}
            aria-label="نوع محصول"
          >
            <option value="">همه محصولات</option>
            <option value="CLOUD_SERVER">سرور ابری</option>
            <option value="READY_INSTANT_SERVER">سرور آماده</option>
          </select>
          <input
            placeholder="منطقه / Location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
          <select
            value={chinishTier}
            onChange={(event) => setChinishTier(event.target.value)}
            aria-label="چینش"
          >
            <option value="">همه چینش‌ها</option>
            <option value="NO">نو</option>
            <option value="OSTOVAR">استوار</option>
            <option value="KAHKESHAN">کهکشان</option>
          </select>
          <select
            value={parchinLevel}
            onChange={(event) => setParchinLevel(event.target.value)}
            aria-label="سطح پرچین"
          >
            <option value="">همه پرچین‌ها</option>
            <option value="PARCHIN_START">شروع</option>
            <option value="PARCHIN_ACTIVE">فعال</option>
            <option value="PARCHIN_STABLE">پایدار</option>
          </select>
          <select
            value={orderStatus}
            onChange={(event) => setOrderStatus(event.target.value)}
            aria-label="وضعیت سفارش"
          >
            <option value="">پرداخت‌شده و بازگشت</option>
            <option value="PAID">پرداخت‌شده</option>
            <option value="REFUNDED">بازگشت‌شده</option>
          </select>
          <select
            value={dataQuality}
            onChange={(event) => setDataQuality(event.target.value)}
            aria-label="کیفیت داده"
          >
            <option value="">همه کیفیت‌ها</option>
            <option value="FINAL">نهایی</option>
            <option value="ESTIMATED">تخمینی</option>
            <option value="NEEDS_RECONCILIATION">نیاز به تطبیق</option>
          </select>
        </div>

        <div className="accounting-toolbar-actions">
          <button
            type="button"
            className="product-btn product-btn--quiet"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden="true" />
            تازه‌سازی
          </button>
          <button
            type="button"
            className="product-btn product-btn--primary"
            onClick={exportCsv}
          >
            <Download size={14} aria-hidden="true" />
            خروجی CSV
          </button>
        </div>
      </div>

      <nav className="finance-nav" aria-label="بخش‌های حسابداری" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={
              tab === item.id
                ? "finance-nav-pill finance-nav-pill--active"
                : "finance-nav-pill"
            }
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? <p className="pricing-save-err">{error}</p> : null}
      {loading ? <p className="product-muted">در حال بارگذاری…</p> : null}

      {tab === "overview" || tab === "sales" || tab === "tax" || tab === "wallet" ? (
        <div className="accounting-kpi-grid">
          {kpiCards.map((card) => {
            const value = kpis?.[card.key];
            if (typeof value !== "string") return null;
            if (tab === "tax" && card.key !== "taxRial") return null;
            if (
              tab === "wallet" &&
              card.key !== "grossBilledRial" &&
              card.key !== "operatingExpenseRial"
            ) {
              return null;
            }
            const prev =
              previousKpis && typeof previousKpis[card.key] === "string"
                ? (previousKpis[card.key] as string)
                : null;
            const delta = deltaLabel(value, prev);
            return (
              <div className="accounting-kpi-card" key={card.key} title={card.tip}>
                <span>{card.label}</span>
                <strong className="money-tone money-tone--sale">
                  {formatToman(value)}
                </strong>
                {delta ? <small>{delta}</small> : null}
                <StatusBadge
                  label={view === "booked" ? "ثبت‌شده" : "شناسایی‌شده"}
                  tone="info"
                />
              </div>
            );
          })}
          {kpis ? (
            <div className="accounting-kpi-card" title="حاشیه سود ناخالص موثر">
              <span>حاشیه موثر</span>
              <strong>{bpsLabel(kpis.effectiveMarginBps)}</strong>
              <small>
                کامل بودن داده{" "}
                {(dataCompletenessBps / 100).toLocaleString("fa-IR", {
                  maximumFractionDigits: 1,
                })}
                ٪ · {needsReconciliation.toLocaleString("fa-IR")} مورد تطبیق ·{" "}
                {ordersMissingCost.toLocaleString("fa-IR")} بدون هزینه Snapshot ·{" "}
                {formatToman(needsReconciliationAmount)} نیازمند تطبیق
              </small>
              {kpis.grossProfitExact === false ? (
                <StatusBadge label="سود قطعی نیست" tone="warning" />
              ) : (
                <StatusBadge
                  label={view === "booked" ? "ثبت‌شده" : "شناسایی‌شده (پیش‌بینی)"}
                  tone="info"
                />
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {(tab === "overview" || tab === "sales") && revenueMix ? (
        <SectionCard title="ترکیب درآمد و هزینه">
          <div className="accounting-mix-bar" role="img" aria-label="ترکیب">
            <span style={{ width: `${Math.max(revenueMix.net, 0)}%` }} className="mix-net" />
            <span style={{ width: `${Math.max(revenueMix.cogs, 0)}%` }} className="mix-cogs" />
            <span style={{ width: `${Math.max(revenueMix.opex, 0)}%` }} className="mix-opex" />
            <span
              style={{ width: `${Math.max(revenueMix.profit, 0)}%` }}
              className="mix-profit"
            />
          </div>
          <p className="finance-share-legend">
            <span>فروش خالص</span>
            <span>بهای تمام‌شده</span>
            <span>هزینه عملیاتی</span>
            <span>سود عملیاتی</span>
          </p>
          <svg
            className="accounting-timeline"
            viewBox="0 0 320 60"
            role="img"
            aria-label="خط زمانی فروش دوره"
          >
            {orders.slice(0, 24).map((row, index) => {
              const x = 10 + index * 12;
              const profitBasis = row.grossProfitRial ?? row.netSalesExclTaxRial;
              const height = Math.min(
                40,
                Math.max(4, Number(BigInt(profitBasis) / 10_000_000n)),
              );
              return (
                <rect
                  key={row.orderId}
                  x={x}
                  y={50 - height}
                  width={8}
                  height={height}
                  rx={2}
                  fill={
                    row.grossProfitRial.startsWith("-") ? "#c62828" : "#1565c0"
                  }
                />
              );
            })}
          </svg>
        </SectionCard>
      ) : null}

      {tab === "overview" || tab === "sales" || tab === "reconciliation" ? (
        <SectionCard
          title={
            tab === "reconciliation"
              ? "سفارش‌های نیازمند تطبیق"
              : "سودآوری سفارش‌ها"
          }
        >
          <div style={{ overflowX: "auto" }}>
            <table className="product-table">
              <thead>
                <tr>
                  <th>سفارش</th>
                  <th>وضعیت</th>
                  <th>فروش خالص</th>
                  <th>بهای تمام‌شده</th>
                  <th>سود ناخالص</th>
                  <th>حاشیه</th>
                  <th>کیفیت</th>
                </tr>
              </thead>
              <tbody>
                {(tab === "reconciliation"
                  ? orders.filter(
                      (row) =>
                        row.quality === "NEEDS_RECONCILIATION" ||
                        row.missingProviderCost,
                    )
                  : orders
                )
                  .slice(0, 50)
                  .map((row) => (
                    <tr
                      key={row.orderId}
                      className="accounting-order-row"
                      onClick={() => setSelectedOrderId(row.orderId)}
                    >
                      <td className="product-tech">{row.orderId.slice(0, 10)}…</td>
                      <td>{row.status}</td>
                      <td className="money-tone money-tone--sale">
                        {formatToman(row.netSalesExclTaxRial)}
                      </td>
                      <td className="money-tone money-tone--cost">
                        {formatToman(row.providerCogsRial)}
                      </td>
                      <td>
                        {row.grossProfitRial == null || row.missingProviderCost
                          ? "— (نیاز به تطبیق)"
                          : formatToman(row.grossProfitRial)}
                      </td>
                      <td>
                        {row.grossProfitRial == null
                          ? "—"
                          : bpsLabel(row.effectiveMarginBps)}
                      </td>
                      <td>
                        <StatusBadge
                          label={
                            row.quality === "FINAL"
                              ? "نهایی"
                              : row.quality === "ESTIMATED"
                                ? "تخمینی"
                                : row.quality === "NEEDS_RECONCILIATION"
                                  ? "تطبیق"
                                  : row.quality ?? "—"
                          }
                          tone={
                            row.quality === "FINAL"
                              ? "success"
                              : row.quality === "NEEDS_RECONCILIATION"
                                ? "warning"
                                : "info"
                          }
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {tab === "refunds" ? (
        <SectionCard title="بازگشت‌های فروش">
          {refundOrders.length === 0 ? (
            <p className="product-muted">بازگشتی در این بازه نیست.</p>
          ) : (
            <ul className="accounting-simple-list">
              {refundOrders.map((row) => (
                <li key={row.orderId}>
                  <strong className="product-tech">{row.orderId}</strong>
                  <span>{formatToman(row.netSalesExclTaxRial)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      {tab === "expenses" ? (
        <div className="accounting-expenses">
          <SectionCard title="ثبت هزینه عملیاتی">
            <div className="pricing-rules-grid">
              <label className="pricing-field">
                <span>تاریخ</span>
                <input
                  type="date"
                  value={expenseForm.date}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="pricing-field">
                <span>مبلغ (تومان)</span>
                <input
                  inputMode="numeric"
                  value={expenseForm.amountToman}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      amountToman: event.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </label>
              <label className="pricing-field">
                <span>دسته</span>
                <select
                  value={expenseForm.category}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                >
                  <option value="GATEWAY_FEES">کارمزد درگاه</option>
                  <option value="SMS_EXPENSE">پیامک</option>
                  <option value="SUPPORT_OPERATIONS">پشتیبانی</option>
                  <option value="HOSTING_OPERATIONS">عملیات میزبانی</option>
                  <option value="MARKETING_EXPENSE">بازاریابی</option>
                  <option value="PAYROLL_CONTRACTOR">پیمانکار/حقوق</option>
                  <option value="OTHER_OPERATING_EXPENSE">سایر</option>
                </select>
              </label>
              <label className="pricing-field">
                <span>عنوان</span>
                <input
                  value={expenseForm.title}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="pricing-field">
                <span>فروشنده / مرجع</span>
                <input
                  value={expenseForm.vendor}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      vendor: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="product-btn product-btn--primary"
              disabled={savingExpense}
              onClick={() => void createExpense()}
            >
              <Calculator size={14} aria-hidden="true" />
              ذخیره پیش‌نویس
            </button>
          </SectionCard>

          <SectionCard title="فهرست هزینه‌ها">
            <div style={{ overflowX: "auto" }}>
              <table className="product-table">
                <thead>
                  <tr>
                    <th>تاریخ</th>
                    <th>عنوان</th>
                    <th>دسته</th>
                    <th>مبلغ</th>
                    <th>وضعیت</th>
                    <th>اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {new Date(row.date).toLocaleDateString("fa-IR")}
                      </td>
                      <td>{row.title}</td>
                      <td>{categoryLabel(row.category)}</td>
                      <td className="money-tone money-tone--cost">
                        {formatToman(row.amountRial)}
                      </td>
                      <td>
                        <StatusBadge
                          label={
                            row.status === "DRAFT"
                              ? "پیش‌نویس"
                              : row.status === "POSTED"
                                ? "ثبت‌شده"
                                : "برگشت‌خورده"
                          }
                          tone={
                            row.status === "POSTED"
                              ? "success"
                              : row.status === "REVERSED"
                                ? "warning"
                                : "info"
                          }
                        />
                      </td>
                      <td>
                        {row.status === "DRAFT" ? (
                          <button
                            type="button"
                            className="product-btn product-btn--quiet"
                            disabled={savingExpense}
                            onClick={() => void postExpense(row.id)}
                          >
                            ثبت نهایی
                          </button>
                        ) : null}
                        {row.status === "POSTED" ? (
                          <button
                            type="button"
                            className="product-btn product-btn--quiet"
                            disabled={savingExpense}
                            onClick={() => void reverseExpense(row.id)}
                          >
                            برگشت
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {tab === "wallet" ? (
        <SectionCard title="کیف پول (عملیاتی)">
          <p className="pricing-field-hint">
            شارژ کیف پول درآمد فروش نیست؛ اینجا فقط برای دید عملیاتی کنار فروش
            و هزینه نشان داده می‌شود. جزئیات Ledger در «تراکنش‌ها» است.
          </p>
          <Linkish href="/admin/wallets" />
        </SectionCard>
      ) : null}

      {tab === "journal" ? (
        <SectionCard title="دفتر روزنامه عملیاتی">
          <ul className="accounting-journal-list">
            {journal.map((entry) => (
              <li key={entry.id}>
                <div className="accounting-journal-head">
                  <strong>{entry.eventType}</strong>
                  <StatusBadge
                    label={
                      entry.quality === "FINAL"
                        ? "نهایی"
                        : entry.quality === "ESTIMATED"
                          ? "تخمینی"
                          : entry.quality
                    }
                    tone={entry.quality === "FINAL" ? "success" : "info"}
                  />
                  <span className="product-muted">
                    {new Date(entry.occurredAt).toLocaleString("fa-IR")}
                  </span>
                </div>
                <p className="product-tech">
                  {entry.referenceType}:{entry.referenceId}
                </p>
                <ul>
                  {entry.lines.map((line) => (
                    <li key={line.id}>
                      {line.accountCode} — بدهکار{" "}
                      {formatToman(line.debitRial)} / بستانکار{" "}
                      {formatToman(line.creditRial)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {selectedOrder ? (
        <div className="accounting-drawer" role="dialog" aria-modal="false">
          <div className="accounting-drawer-panel">
            <div className="accounting-drawer-head">
              <h3>
                <FileText size={16} aria-hidden="true" /> جزئیات سفارش
              </h3>
              <button
                type="button"
                className="product-btn product-btn--quiet"
                onClick={() => setSelectedOrderId(null)}
              >
                بستن
              </button>
            </div>
            <dl className="accounting-drawer-dl">
              <div>
                <dt>شناسه</dt>
                <dd className="product-tech">{selectedOrder.orderId}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{selectedOrder.provider ?? "—"}</dd>
              </div>
              <div>
                <dt>محصول</dt>
                <dd>{selectedOrder.productKind ?? "—"}</dd>
              </div>
              <div>
                <dt>منطقه</dt>
                <dd>{selectedOrder.regionCode ?? "—"}</dd>
              </div>
              <div>
                <dt>پرچین</dt>
                <dd>{selectedOrder.parchinLevel ?? "—"}</dd>
              </div>
              <div>
                <dt>دوره</dt>
                <dd>{selectedOrder.termMonths.toLocaleString("fa-IR")} ماه</dd>
              </div>
              <div>
                <dt>فروش ناخالص</dt>
                <dd>{formatToman(selectedOrder.grossBilledRial)}</dd>
              </div>
              <div>
                <dt>مالیات</dt>
                <dd>{formatToman(selectedOrder.taxRial)}</dd>
              </div>
              <div>
                <dt>بهای تمام‌شده</dt>
                <dd className="money-tone money-tone--cost">
                  {formatToman(selectedOrder.providerCogsRial)}
                </dd>
              </div>
              <div>
                <dt>سود ناخالص</dt>
                <dd className="money-tone money-tone--sale">
                  {selectedOrder.grossProfitRial == null ||
                  selectedOrder.missingProviderCost
                    ? "— (بدون هزینه Provider قابل محاسبه نیست)"
                    : formatToman(selectedOrder.grossProfitRial)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Linkish({ href }: { href: string }) {
  return (
    <a href={href} className="product-btn product-btn--quiet">
      <Wallet size={14} aria-hidden="true" />
      رفتن به کیف پول‌ها
    </a>
  );
}
