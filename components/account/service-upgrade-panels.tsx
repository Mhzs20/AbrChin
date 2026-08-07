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
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0 }}>ارتقای سرور</h2>
        <p style={{ margin: "8px 0 0" }}>
          سرور: <strong dir="ltr">{serverName}</strong>
        </p>
      </div>

      {current ? (
        <section>
          <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>منابع فعلی</h3>
          <p dir="ltr" style={{ margin: 0, fontWeight: 600 }}>
            {formatResources(current)}
          </p>
        </section>
      ) : null}

      {loading ? <p>در حال بارگذاری گزینه‌های مجاز…</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {!loading && targets.length === 0 && !error ? (
        <p>فعلاً مقصد ارتقای قابل فروش برای این سرور در دسترس نیست.</p>
      ) : null}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {targets.map((target) => (
          <li
            key={target.planId}
            style={{
              borderTop: "1px solid color-mix(in oklab, var(--product-ink) 12%, transparent)",
              paddingTop: 12,
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <strong>{target.planTitle}</strong>
              <span dir="ltr">{formatResources(target)}</span>
              <span>
                هزینه ارتقا: <strong>{target.upgradeChargeTomanFa}</strong> تومان
              </span>
              <button
                type="button"
                className="product-btn"
                disabled={busy || !target.available}
                onClick={() => void createQuote(target.planId)}
              >
                {target.available ? "ادامه و دریافت پیش‌فاکتور" : "ناموجود"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
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
    <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <div>
        <h2 style={{ margin: 0 }}>پیش‌فاکتور ارتقا</h2>
        {!expired && !quote.paid ? (
          <div style={{ marginTop: 8 }}>
            <QuoteCountdown expiresAt={quote.expiresAt} prominent />
          </div>
        ) : null}
      </div>

      <section style={{ display: "grid", gap: 8 }}>
        <div>
          <small>منابع فعلی</small>
          <p dir="ltr" style={{ margin: 0, fontWeight: 600 }}>
            {formatResources(quote.current)}
          </p>
        </div>
        <div>
          <small>منابع جدید</small>
          <p dir="ltr" style={{ margin: 0, fontWeight: 600 }}>
            {formatResources(quote.target)}
          </p>
          <p style={{ margin: "4px 0 0" }}>{quote.target.planTitle}</p>
        </div>
        <div>
          <small>تغییر مؤثر</small>
          <p dir="ltr" style={{ margin: 0 }}>
            +{quote.delta.vcpu} vCPU / +{quote.delta.ramGb} GB RAM / +
            {quote.delta.diskGb} GB Disk
          </p>
        </div>
      </section>

      <section style={{ display: "grid", gap: 6 }}>
        <p style={{ margin: 0 }}>
          هزینه ارتقا: <strong>{quote.upgradeChargeTomanFa}</strong> تومان
        </p>
        <p style={{ margin: 0 }}>
          موجودی کیف پول: <strong>{quote.walletBalanceTomanFa}</strong> تومان
        </p>
        {quote.walletBalanceAfterTomanFa && !expired && !quote.paid ? (
          <p style={{ margin: 0 }}>
            مانده پس از ارتقا:{" "}
            <strong>{quote.walletBalanceAfterTomanFa}</strong> تومان
          </p>
        ) : null}
        {shortfall > 0n && !expired && !quote.paid ? (
          <p style={{ margin: 0 }}>
            کسری: <strong>{quote.shortfallTomanFa}</strong> تومان
          </p>
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
    </div>
  );
}
