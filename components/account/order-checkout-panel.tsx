"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { useToast } from "@/components/product/toast";

function formatRialAsToman(value: string) {
  return (BigInt(value) / 10n).toLocaleString("fa-IR");
}

/** Rial → whole toman, rounded up so the top-up always covers the gap. */
function rialToTomanCeil(value: bigint) {
  return (value + 9n) / 10n;
}

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
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState<"wallet" | "gateway" | null>(null);
  const paymentKey = useRef<string | null>(null);

  const amount = amountRial != null ? BigInt(amountRial) : null;
  const balance = walletBalanceRial != null ? BigInt(walletBalanceRial) : null;
  const shortfall =
    amount != null && balance != null && amount > balance
      ? amount - balance
      : 0n;
  const walletReady = amount != null && balance != null && shortfall === 0n;
  const topUpHref =
    returnToPath && shortfall > 0n
      ? `/account/wallet/topup?returnTo=${encodeURIComponent(returnToPath)}&amount=${rialToTomanCeil(shortfall).toString()}`
      : null;

  async function createOrder(): Promise<{ id: string } | null> {
    const createRes = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quoteId ? { quoteId } : { planId }),
    });
    const createBody = await createRes.json();
    if (!createRes.ok) {
      if (createBody.replacementQuote?.id) {
        showToast("قیمت تغییر کرده؛ پیشنهاد تازه نمایش داده شد.");
        router.push(`${quoteBasePath}/${createBody.replacementQuote.id}`);
        router.refresh();
        return null;
      }
      throw new Error(createBody.error ?? "ساخت سفارش ناموفق بود");
    }
    if (createBody.order.amountTomanFa !== priceToman) {
      showToast("قیمت تغییر کرده است؛ قیمت تازه را بررسی و دوباره تأیید کنید.");
      router.refresh();
      return null;
    }
    return createBody.order as { id: string };
  }

  async function handleWalletPurchase() {
    setLoading("wallet");
    try {
      const order = await createOrder();
      if (!order) return;
      const payRes = await fetch(`/api/orders/${order.id}/pay-with-wallet`, {
        method: "POST",
      });
      const payBody = await payRes.json();
      if (!payRes.ok) {
        if (payBody.code === "insufficient_funds") {
          showToast("موجودی کیف پول کافی نیست؛ ابتدا شارژ کن.");
          router.refresh();
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
      setLoading(null);
    }
  }

  async function handleGatewayPurchase() {
    setLoading("gateway");
    try {
      const order = await createOrder();
      if (!order) return;
      paymentKey.current ??= crypto.randomUUID();
      const payRes = await fetch(`/api/orders/${order.id}/payment`, {
        method: "POST",
        headers: { "Idempotency-Key": paymentKey.current },
      });
      const payBody = await payRes.json();
      if (!payRes.ok) {
        throw new Error(payBody.error ?? "پرداخت ناموفق بود");
      }
      if (payBody.alreadyPaid) {
        router.push(`/account/orders/${order.id}`);
        router.refresh();
        return;
      }
      if (!payBody.redirectUrl) {
        throw new Error("انتقال امن به درگاه پرداخت ممکن نشد.");
      }
      showToast(`در حال انتقال به درگاه پرداخت برای ${planTitle}`);
      window.location.assign(payBody.redirectUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "عملیات ناموفق بود");
    } finally {
      setLoading(null);
    }
  }

  const discountPercent = Math.round(termDiscountBps / 100);
  const showWalletSummary = amount != null && balance != null;

  return (
    <section className="product-card order-checkout" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>ثبت سفارش</h2>
      <p>
        دوره شارژ: <strong>{termMonths.toLocaleString("fa-IR")} ماه</strong>
        {discountPercent > 0 ? (
          <>
            {" "}
            · تخفیف{" "}
            <strong>
              {discountPercent.toLocaleString("fa-IR")}٪
              {couponCode ? ` (کد ${couponCode})` : " دوره‌ای"}
            </strong>
          </>
        ) : null}
      </p>
      {lineItems.length > 0 ? (
        <ul style={{ margin: "0 0 12px", paddingInlineStart: 18 }}>
          {lineItems.map((item) => (
            <li key={`${item.type}:${item.label}`}>
              {item.label}: {formatRialAsToman(item.amountRial)} تومان
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        مبلغ قابل پرداخت: <strong>{priceToman} تومان</strong>
      </p>

      {showWalletSummary ? (
        <div className="order-wallet-summary">
          <div className="order-wallet-row">
            <span>موجودی کیف پول</span>
            <strong className="order-wallet-balance">
              {formatRialAsToman(balance!.toString())} تومان
            </strong>
          </div>
          {shortfall > 0n ? (
            <div className="order-wallet-row order-wallet-row--shortfall">
              <span>کسری برای این سفارش</span>
              <strong>
                {rialToTomanCeil(shortfall).toLocaleString("fa-IR")} تومان
              </strong>
            </div>
          ) : (
            <p className="order-wallet-ok">
              موجودی برای این سفارش کافی است؛ مبلغ از کیف پول کسر می‌شود.
            </p>
          )}
        </div>
      ) : null}

      <p className="order-checkout-legal">
        با ادامه خرید،{" "}
        <Link href="/terms">شرایط استفاده</Link> و{" "}
        <Link href="/refund-policy">سیاست بازپرداخت</Link> را می‌پذیری. ساخت و
        تحویل پس از تأیید ابرچین انجام می‌شود.
      </p>

      <div className="order-checkout-actions">
        {walletReady ? (
          <button
            type="button"
            className="product-btn product-btn--primary"
            disabled={loading !== null}
            onClick={handleWalletPurchase}
          >
            {loading === "wallet"
              ? "در حال پرداخت..."
              : "پرداخت از کیف پول و ثبت سفارش"}
          </button>
        ) : topUpHref ? (
          <Link className="product-btn product-btn--primary" href={topUpHref}>
            شارژ کیف پول به مبلغ کسری و بازگشت
          </Link>
        ) : null}

        <button
          type="button"
          className={
            walletReady || topUpHref
              ? "product-btn product-btn--quiet"
              : "product-btn product-btn--primary"
          }
          disabled={loading !== null}
          onClick={handleGatewayPurchase}
        >
          {loading === "gateway"
            ? "در حال انتقال به درگاه..."
            : "پرداخت مستقیم از درگاه"}
        </button>
      </div>
      {topUpHref ? (
        <p className="order-checkout-hint">
          بعد از شارژ موفق به همین صفحه برمی‌گردی؛ مشخصات سرور حفظ می‌شود و با
          تأیید نهایی مبلغ از کیف پول کسر و سفارش ثبت می‌شود.
        </p>
      ) : null}
    </section>
  );
}
