"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { QuoteCountdown } from "@/components/quote-countdown";

function formatResources(r: {
  vcpu: number;
  ramGb: number;
  diskGb: number;
}) {
  return `${r.vcpu} vCPU / ${r.ramGb} GB RAM / ${r.diskGb} GB Disk`;
}

function rialToTomanCeil(value: bigint) {
  return (value + 9n) / 10n;
}

type Target = {
  planId: string;
  planTitle: string;
  vcpu: number;
  ramGb: number;
  diskGb: number;
  upgradeChargeRial: string;
  upgradeChargeTomanFa: string;
  available: boolean;
};

type QuoteView = {
  id: string;
  instanceId: string;
  expired: boolean;
  paid: boolean;
  expiresAt: string;
  current: { vcpu: number; ramGb: number; diskGb: number; planTitle: string };
  target: { vcpu: number; ramGb: number; diskGb: number; planTitle: string };
  delta: { vcpu: number; ramGb: number; diskGb: number };
  upgradeChargeRial: string;
  upgradeChargeTomanFa: string;
  walletBalanceRial: string;
  walletBalanceTomanFa: string;
  walletBalanceAfterRial: string | null;
  walletBalanceAfterTomanFa: string | null;
  shortfallRial: string;
  shortfallTomanFa: string;
  status: string;
};

export function ServiceUpgradeChooser({
  instanceId,
  serverName,
  initialCurrent,
}: {
  instanceId: string;
  serverName: string;
  initialCurrent?: {
    vcpu?: number | null;
    ramGb?: number | null;
    diskGb?: number | null;
  } | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(
    initialCurrent &&
      initialCurrent.vcpu != null &&
      initialCurrent.ramGb != null &&
      initialCurrent.diskGb != null
      ? {
          vcpu: initialCurrent.vcpu,
          ramGb: initialCurrent.ramGb,
          diskGb: initialCurrent.diskGb,
        }
      : null,
  );
  const [targets, setTargets] = useState<Target[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/account/instances/${instanceId}/upgrade`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as {
          error?: string;
          current?: {
            vcpu: number;
            ramGb: number;
            diskGb: number;
          };
          targets?: Target[];
        };
        if (!response.ok) {
          throw new Error(body.error || "بارگذاری گزینه‌ها ممکن نشد.");
        }
        if (cancelled) return;
        if (body.current) setCurrent(body.current);
        setTargets(body.targets ?? []);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "بارگذاری گزینه‌ها ممکن نشد.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  async function createQuote(targetPlanId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/account/instances/${instanceId}/upgrade`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetPlanId }),
        },
      );
      const body = (await response.json()) as {
        error?: string;
        quote?: { id: string };
      };
      if (!response.ok || !body.quote) {
        throw new Error(body.error || "ایجاد پیش‌فاکتور ممکن نشد.");
      }
      router.push(`/account/upgrade/${body.quote.id}`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "ایجاد پیش‌فاکتور ممکن نشد.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="product-section">
      <h2 className="product-section-title">ارتقای سرور</h2>
      <p style={{ marginTop: 0 }}>
        سرور: <strong dir="ltr">{serverName}</strong>
      </p>

      {current ? (
        <section aria-label="منابع فعلی">
          <h3 className="product-section-title">منابع فعلی</h3>
          <div className="product-stat-grid">
            <div className="product-stat-card">
              <div className="product-stat-card-label">پردازنده</div>
              <div className="product-stat-card-value" dir="ltr">
                {current.vcpu} vCPU
              </div>
            </div>
            <div className="product-stat-card">
              <div className="product-stat-card-label">حافظه</div>
              <div className="product-stat-card-value" dir="ltr">
                {current.ramGb} GB
              </div>
            </div>
            <div className="product-stat-card">
              <div className="product-stat-card-label">دیسک</div>
              <div className="product-stat-card-value" dir="ltr">
                {current.diskGb} GB
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {loading ? <p>در حال بارگذاری گزینه‌های مجاز…</p> : null}
      {error ? <p className="product-error">{error}</p> : null}

      {!loading && targets.length === 0 && !error ? (
        <p className="product-empty">
          فعلاً مقصد ارتقای قابل فروش برای این سرور در دسترس نیست.
        </p>
      ) : null}

      <div className="product-row-list" style={{ display: "grid", gap: 12 }}>
        {targets.map((target) => (
          <article className="product-row-card" key={target.planId}>
            <strong>{target.planTitle}</strong>
            <div className="product-stat-grid" style={{ marginTop: 10 }}>
              <div className="product-stat-card">
                <div className="product-stat-card-label">پردازنده</div>
                <div className="product-stat-card-value" dir="ltr">
                  {target.vcpu} vCPU
                </div>
              </div>
              <div className="product-stat-card">
                <div className="product-stat-card-label">حافظه</div>
                <div className="product-stat-card-value" dir="ltr">
                  {target.ramGb} GB
                </div>
              </div>
              <div className="product-stat-card">
                <div className="product-stat-card-label">دیسک</div>
                <div className="product-stat-card-value" dir="ltr">
                  {target.diskGb} GB
                </div>
              </div>
            </div>
            <p style={{ margin: "10px 0" }}>
              هزینه ارتقا: <strong>{target.upgradeChargeTomanFa}</strong> تومان
            </p>
            <button
              type="button"
              className="product-btn product-btn--primary"
              disabled={busy || !target.available}
              onClick={() => void createQuote(target.planId)}
            >
              {target.available ? "ادامه و دریافت پیش‌فاکتور" : "ناموجود"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ServiceUpgradeQuotePanel({
  quoteId,
  initialQuote,
}: {
  quoteId: string;
  initialQuote: QuoteView;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState(initialQuote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const paymentKey = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const expired =
    quote.expired || new Date(quote.expiresAt).getTime() <= now;
  const shortfall = BigInt(quote.shortfallRial);
  const charge = BigInt(quote.upgradeChargeRial);
  const returnToPath = `/account/upgrade/${quoteId}`;
  const shortfallToman = shortfall > 0n ? rialToTomanCeil(shortfall) : 0n;
  const topUpHref =
    !expired && !quote.paid && shortfall > 0n
      ? `/account/wallet/topup?returnTo=${encodeURIComponent(returnToPath)}&amount=${shortfallToman.toString()}`
      : null;

  async function refreshQuote() {
    const response = await fetch(
      `/api/account/resource-changes/${quoteId}`,
      { cache: "no-store" },
    );
    const body = (await response.json()) as {
      error?: string;
      quote?: QuoteView;
    };
    if (response.ok && body.quote) {
      setQuote(body.quote);
    }
  }

  async function payWithWallet() {
    setBusy(true);
    setError(null);
    setMessage(null);
    if (!paymentKey.current) {
      paymentKey.current = `upgrade-pay:${quoteId}:${crypto.randomUUID()}`;
    }
    try {
      const response = await fetch(
        `/api/account/resource-changes/${quoteId}/pay-with-wallet`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": paymentKey.current,
          },
          body: "{}",
        },
      );
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        quote?: QuoteView;
      };
      if (!response.ok) {
        if (body.code === "quote_expired" || body.code === "target_unavailable") {
          await refreshQuote();
        }
        throw new Error(body.error || "پرداخت ممکن نشد.");
      }
      if (body.quote) setQuote(body.quote);
      setMessage(
        "مبلغ ارتقا از کیف پول برداشت شد. اعمال منابع پس از تأیید ادمین انجام می‌شود.",
      );
      router.refresh();
    } catch (payError) {
      setError(
        payError instanceof Error ? payError.message : "پرداخت ممکن نشد.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-section order-checkout">
      <div>
        <h2 className="product-section-title">پیش‌فاکتور ارتقا</h2>
        {!expired && !quote.paid ? (
          <p className="order-checkout-lock">
            <QuoteCountdown expiresAt={quote.expiresAt} prominent />
          </p>
        ) : null}
      </div>

        <section className="order-checkout-summary" aria-label="منابع">
          <div className="order-checkout-summary-row">
            <span>منابع فعلی</span>
            <strong dir="ltr">{formatResources(quote.current)}</strong>
          </div>
          <div className="order-checkout-summary-row">
            <span>منابع جدید</span>
            <strong dir="ltr">{formatResources(quote.target)}</strong>
          </div>
          <div className="order-checkout-summary-row">
            <span>پلن مقصد</span>
            <strong>{quote.target.planTitle}</strong>
          </div>
          <div className="order-checkout-summary-row">
            <span>تغییر مؤثر</span>
            <strong dir="ltr">
              +{quote.delta.vcpu} vCPU / +{quote.delta.ramGb} GB / +
              {quote.delta.diskGb} GB
            </strong>
          </div>
        </section>

        <section className="order-wallet-summary" aria-label="تأثیر کیف پول">
          <div className="order-wallet-row">
            <span>هزینه ارتقا</span>
            <strong>{quote.upgradeChargeTomanFa} تومان</strong>
          </div>
          <div className="order-wallet-row">
            <span>موجودی کیف پول</span>
            <strong className="order-wallet-balance">
              {quote.walletBalanceTomanFa} تومان
            </strong>
          </div>
          {quote.walletBalanceAfterTomanFa && !expired && !quote.paid ? (
            <div className="order-wallet-row">
              <span>مانده پس از ارتقا</span>
              <strong>{quote.walletBalanceAfterTomanFa} تومان</strong>
            </div>
          ) : null}
          {shortfall > 0n && !expired && !quote.paid ? (
            <div className="order-wallet-row order-wallet-row--shortfall">
              <span>کسری</span>
              <strong>{quote.shortfallTomanFa} تومان</strong>
            </div>
          ) : null}
        </section>

      {quote.paid ? (
        <p style={{ color: "var(--product-success, green)" }}>
          پرداخت انجام شد. وضعیت: در انتظار تأیید و اعمال ادمین.
        </p>
      ) : null}

      {expired && !quote.paid ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p>
            اعتبار این پیش‌فاکتور تمام شد. مبلغ شارژشده در کیف پول محفوظ است؛
            برای ادامه باید پیش‌فاکتور جدید بگیری.
          </p>
          <Link
            className="product-btn"
            href={`/account/services/${quote.instanceId}/upgrade`}
          >
            دریافت پیش‌فاکتور جدید
          </Link>
        </div>
      ) : null}

      {!expired && !quote.paid && shortfall === 0n && charge > 0n ? (
        <button
          type="button"
          className="product-btn"
          disabled={busy}
          onClick={() => void payWithWallet()}
        >
          {busy ? "…" : "ارتقا با موجودی کیف پول"}
        </button>
      ) : null}

      {!expired && !quote.paid && topUpHref ? (
        <Link className="product-btn" href={topUpHref}>
          {`شارژ ${shortfallToman.toLocaleString("fa-IR")} تومان و ادامه ارتقا`}
        </Link>
      ) : null}

      {message ? (
        <p style={{ color: "var(--product-success, green)" }}>{message}</p>
      ) : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      <Link
        className="product-btn product-btn--quiet"
        href={`/account/services/${quote.instanceId}/upgrade`}
      >
        بازگشت به انتخاب منابع
      </Link>
    </section>
  );
}
