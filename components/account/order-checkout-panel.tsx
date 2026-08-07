"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { QuoteCountdown } from "@/components/quote-countdown";
import { useToast } from "@/components/product/toast";

function formatRialAsToman(value: string | bigint) {
  return (BigInt(value) / 10n).toLocaleString("fa-IR");
}

/** Rial → whole toman, rounded up so the top-up always covers the gap. */
function rialToTomanCeil(value: bigint) {
  return (value + 9n) / 10n;
}

export type CheckoutServerSummary = {
  title: string;
  locationLabel: string;
  vcpu: number | null;
  ramGb: number | null;
  storageGb: number | null;
  operatingSystem: string;
  termMonths: 1 | 3 | 6 | 12;
  serverName?: string | null;
};

type CheckoutState =
  | "ready"
  | "shortfall"
  | "expired"
  | "unavailable"
  | "loading";

export function OrderCheckoutPanel({
  planId,
  quoteId,
  planTitle,
  priceToman,
  termMonths = 1,
  termDiscountBps = 0,
  couponCode = null,
  lineItems = [],
  amountRial = null,
  walletBalanceRial = null,
  returnToPath = null,
  quoteBasePath = "/account/order/quote",
  expiresAt = null,
  serverSummary = null,
  refreshApiPath = null,
}: {
  planId?: string;
  quoteId?: string;
  planTitle: string;
  priceToman: string;
  termMonths?: 1 | 3 | 6 | 12;
  termDiscountBps?: number;
  couponCode?: string | null;
  lineItems?: Array<{ type: string; label: string; amountRial: string }>;
  /** Total payable amount in rial (string bigint). Enables wallet-first UX. */
  amountRial?: string | null;
  /** Current wallet balance in rial (string bigint). */
  walletBalanceRial?: string | null;
  /** Path to return to after wallet top-up (usually this quote page). */
  returnToPath?: string | null;
  /** Where replacement quotes should be opened. */
  quoteBasePath?: string;
  /** Locked quote expiry; drives countdown and expired CTA. */
  expiresAt?: string | null;
  /** Customer-facing locked server summary. */
  serverSummary?: CheckoutServerSummary | null;
  /** Explicit refresh endpoint for expired quotes. */
  refreshApiPath?: string | null;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<CheckoutState | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const paymentKey = useRef<string | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const amount = amountRial != null ? BigInt(amountRial) : null;
  const balance = walletBalanceRial != null ? BigInt(walletBalanceRial) : null;
  const shortfall =
    amount != null && balance != null && amount > balance
      ? amount - balance
      : 0n;
  const balanceAfter =
    amount != null && balance != null && shortfall === 0n
      ? balance - amount
      : null;
  const quoteExpired =
    Boolean(expiresAt) && new Date(expiresAt!).getTime() <= now;
  const walletReady =
    !quoteExpired &&
    checkoutError !== "unavailable" &&
    amount != null &&
    balance != null &&
    shortfall === 0n;
  const shortfallToman =
    shortfall > 0n ? rialToTomanCeil(shortfall) : 0n;
  const topUpHref =
    returnToPath && shortfall > 0n && !quoteExpired
      ? `/account/wallet/topup?returnTo=${encodeURIComponent(returnToPath)}&amount=${shortfallToman.toString()}`
      : null;

  const summary = serverSummary ?? {
    title: planTitle,
    locationLabel: "—",
    vcpu: null,
    ramGb: null,
    storageGb: null,
    operatingSystem: "—",
    termMonths,
    serverName: null,
  };

  const baseItems = lineItems.filter(
    (item) =>
      !["TERM_DISCOUNT", "COUPON_DISCOUNT", "TAX"].includes(item.type),
  );
  const discountItems = lineItems.filter((item) =>
    ["TERM_DISCOUNT", "COUPON_DISCOUNT"].includes(item.type),
  );
  const taxItems = lineItems.filter((item) => item.type === "TAX");

  async function handleRefreshQuote() {
    if (!refreshApiPath || !quoteId || refreshing) return;
    setRefreshing(true);
    try {
      const response = await fetch(refreshApiPath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `quote-refresh-ui:${quoteId}`,
        },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        quote?: { id?: string };
      };
      if (!response.ok || !body.quote?.id) {
        throw new Error(body.error ?? "دریافت قیمت جدید ممکن نیست.");
      }
      router.replace(`${quoteBasePath}/${body.quote.id}?renewed=1`);
      router.refresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "دریافت قیمت جدید ممکن نیست.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function createOrder(): Promise<{ id: string } | null> {
    const createRes = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key":
          paymentKey.current ??
          (paymentKey.current = `quote-checkout-ui:${quoteId ?? planId ?? crypto.randomUUID()}`),
      },
      body: JSON.stringify(quoteId ? { quoteId } : { planId }),
    });
    const createBody = (await createRes.json()) as {
      error?: string;
      code?: string;
      order?: { id: string; amountTomanFa?: string };
    };
    if (!createRes.ok) {
      if (createBody.code === "quote_expired") {
        setCheckoutError("expired");
        return null;
      }
      if (
        createBody.code === "quote_unavailable" ||
        createBody.code === "inventory_unavailable" ||
        createBody.code === "quote_revalidation_failed"
      ) {
        setCheckoutError("unavailable");
        return null;
      }
      throw new Error(createBody.error ?? "ساخت سفارش ناموفق بود");
    }
    if (
      createBody.order?.amountTomanFa &&
      createBody.order.amountTomanFa !== priceToman
    ) {
      // Locked quote amount must match; do not silently accept a new price.
      throw new Error(
        "مبلغ سفارش با قیمت قفل‌شده هم‌خوان نیست؛ صفحه را تازه کن.",
      );
    }
    return createBody.order as { id: string };
  }

  async function handleWalletPurchase() {
    if (quoteExpired) {
      setCheckoutError("expired");
      return;
    }
    setLoading(true);
    setCheckoutError(null);
    try {
      paymentKey.current ??= crypto.randomUUID();
      const order = await createOrder();
      if (!order) return;
      const payRes = await fetch(`/api/orders/${order.id}/pay-with-wallet`, {
        method: "POST",
        headers: {
          "Idempotency-Key": paymentKey.current,
        },
      });
      const payBody = (await payRes.json()) as {
        error?: string;
        code?: string;
      };
      if (!payRes.ok) {
        if (payBody.code === "insufficient_funds") {
          showToast("موجودی کیف پول کافی نیست؛ ابتدا شارژ کن.");
          router.refresh();
          return;
        }
        if (payBody.code === "quote_expired") {
          setCheckoutError("expired");
          return;
        }
        if (
          payBody.code === "quote_unavailable" ||
          payBody.code === "inventory_unavailable"
        ) {
          setCheckoutError("unavailable");
          return;
        }
        throw new Error(payBody.error ?? "پرداخت از کیف پول ناموفق بود");
      }
      showToast("پرداخت انجام شد و سفارش ثبت شد.");
      router.push(`/account/orders/${order.id}?payment=success`);
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "عملیات ناموفق بود");
    } finally {
      setLoading(false);
    }
  }

  const discountPercent = Math.round(termDiscountBps / 100);
  const showWalletSummary = amount != null && balance != null;
  const expired = quoteExpired || checkoutError === "expired";
  const unavailable = checkoutError === "unavailable";

  return (
    <section className="product-section order-checkout" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>خلاصه خرید از کیف پول</h2>

      {expiresAt ? (
        <p className="order-checkout-lock">
          <QuoteCountdown expiresAt={expiresAt} prominent />
        </p>
      ) : null}

      <div className="order-checkout-summary" aria-label="خلاصه سرور">
        <div className="order-checkout-summary-row">
          <span>سرور</span>
          <strong>{summary.title}</strong>
        </div>
        <div className="order-checkout-summary-row">
          <span>موقعیت</span>
          <strong>{summary.locationLabel}</strong>
        </div>
        <div className="order-checkout-summary-row">
          <span>پردازنده</span>
          <strong dir="ltr">{summary.vcpu ?? "—"} vCPU</strong>
        </div>
        <div className="order-checkout-summary-row">
          <span>حافظه</span>
          <strong dir="ltr">{summary.ramGb ?? "—"} GB</strong>
        </div>
        <div className="order-checkout-summary-row">
          <span>دیسک</span>
          <strong dir="ltr">{summary.storageGb ?? "—"} GB</strong>
        </div>
        <div className="order-checkout-summary-row">
          <span>سیستم‌عامل</span>
          <strong dir="ltr">{summary.operatingSystem}</strong>
        </div>
        <div className="order-checkout-summary-row">
          <span>دوره</span>
          <strong>
            {summary.termMonths.toLocaleString("fa-IR")} ماه
            {discountPercent > 0 && !couponCode
              ? ` · تخفیف ${discountPercent.toLocaleString("fa-IR")}٪`
              : ""}
          </strong>
        </div>
        {summary.serverName ? (
          <div className="order-checkout-summary-row">
            <span>نام سرور</span>
            <strong dir="ltr">{summary.serverName}</strong>
          </div>
        ) : null}
      </div>

      <div className="order-checkout-amounts" aria-label="مبالغ قفل‌شده">
        {baseItems.map((item) => (
          <div
            className="order-checkout-summary-row"
            key={`${item.type}:${item.label}`}
          >
            <span>{item.label}</span>
            <strong>{formatRialAsToman(item.amountRial)} تومان</strong>
          </div>
        ))}
        {discountItems.map((item) => (
          <div
            className="order-checkout-summary-row order-checkout-summary-row--credit"
            key={`${item.type}:${item.label}`}
          >
            <span>
              {item.type === "COUPON_DISCOUNT" && couponCode
                ? `تخفیف کد ${couponCode}`
                : item.label}
            </span>
            <strong>{formatRialAsToman(item.amountRial)} تومان</strong>
          </div>
        ))}
        {taxItems.map((item) => (
          <div
            className="order-checkout-summary-row"
            key={`${item.type}:${item.label}`}
          >
            <span>{item.label}</span>
            <strong>{formatRialAsToman(item.amountRial)} تومان</strong>
          </div>
        ))}
        {lineItems.length === 0 ? (
          <div className="order-checkout-summary-row">
            <span>مبلغ پایه</span>
            <strong>{priceToman} تومان</strong>
          </div>
        ) : null}
        <div className="order-checkout-summary-row order-checkout-summary-row--total">
          <span>جمع قفل‌شده</span>
          <strong>{priceToman} تومان</strong>
        </div>
      </div>

      {showWalletSummary ? (
        <div className="order-wallet-summary">
          <div className="order-wallet-row">
            <span>موجودی فعلی کیف پول</span>
            <strong className="order-wallet-balance">
              {formatRialAsToman(balance!.toString())} تومان
            </strong>
          </div>
          <div className="order-wallet-row">
            <span>مبلغ مورد نیاز</span>
            <strong>{formatRialAsToman(amount!.toString())} تومان</strong>
          </div>
          {shortfall > 0n ? (
            <div className="order-wallet-row order-wallet-row--shortfall">
              <span>کسری</span>
              <strong>
                {shortfallToman.toLocaleString("fa-IR")} تومان
              </strong>
            </div>
          ) : (
            <div className="order-wallet-row">
              <span>مانده پس از خرید</span>
              <strong>
                {formatRialAsToman(balanceAfter!.toString())} تومان
              </strong>
            </div>
          )}
        </div>
      ) : null}

      {expired ? (
        <p className="order-checkout-expired" role="status">
          اعتبار قیمت قبلی تمام شده است. مبلغ شارژشده در کیف پول شما محفوظ است.
        </p>
      ) : null}
      {unavailable ? (
        <p className="order-checkout-unavailable" role="status">
          این ظرفیت دیگر قابل تحویل نیست.
        </p>
      ) : null}

      <p className="order-checkout-legal">
        با ادامه خرید،{" "}
        <Link href="/terms">شرایط استفاده</Link> و{" "}
        <Link href="/refund-policy">سیاست بازپرداخت</Link> را می‌پذیری. ساخت و
        تحویل پس از تأیید ابرچین انجام می‌شود. مبلغ سرور فقط از کیف پول کسر
        می‌شود.
      </p>

      <div className="order-checkout-actions">
        {expired ? (
          refreshApiPath ? (
            <button
              type="button"
              className="product-btn product-btn--primary"
              disabled={refreshing}
              onClick={() => void handleRefreshQuote()}
            >
              {refreshing ? "در حال دریافت…" : "دریافت قیمت جدید"}
            </button>
          ) : (
            <Link
              className="product-btn product-btn--primary"
              href={quoteBasePath.replace(/\/quote$/, "") || "/cloud-servers"}
            >
              دریافت قیمت جدید
            </Link>
          )
        ) : unavailable ? (
          <Link
            className="product-btn product-btn--primary"
            href={quoteBasePath.replace(/\/quote$/, "") || "/cloud-servers"}
          >
            این ظرفیت دیگر قابل تحویل نیست
          </Link>
        ) : walletReady ? (
          <button
            type="button"
            className="product-btn product-btn--primary"
            disabled={loading}
            onClick={() => void handleWalletPurchase()}
          >
            {loading ? "در حال پرداخت..." : "خرید و ساخت سرور"}
          </button>
        ) : topUpHref ? (
          <Link className="product-btn product-btn--primary" href={topUpHref}>
            شارژ {shortfallToman.toLocaleString("fa-IR")} تومان و ادامه خرید
          </Link>
        ) : (
          <p className="order-checkout-hint">
            برای خرید این سرور ابتدا وارد شوید تا موجودی کیف پول بررسی شود.
          </p>
        )}
      </div>
      {topUpHref ? (
        <p className="order-checkout-hint">
          بعد از شارژ موفق به همین پیش‌فاکتور برمی‌گردی؛ مشخصات و قیمت قفل‌شده
          حفظ می‌شوند. درگاه فقط برای شارژ کیف پول استفاده می‌شود.
        </p>
      ) : null}
    </section>
  );
}
