import { LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { QuoteExpiredRefresh } from "@/components/quote/quote-expired-refresh";
import {
  readyServerImageLabel,
  readyServerLocation,
} from "@/lib/cloud-servers/catalog";
import {
  effectiveTermDiscountLabel,
  termDiscountCeilingLabel,
} from "@/lib/labels/customer";
import { formatTomanFa } from "@/lib/money";
import { readParchinServiceSnapshot } from "@/lib/parchin/service-contract";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  getActiveCloudServerQuote,
  getOwnedRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";
import { getWalletForUser } from "@/lib/wallet/ensure-wallet";

export const metadata: Metadata = {
  title: "پیش‌فاکتور سرور ابری | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReadyServerQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ renewed?: string }>;
}) {
  const [{ id }, { renewed }] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  const guestToken = user ? null : await getRecommendationGuestToken();
  const quoteRecord = await getActiveCloudServerQuote(
    id,
    user?.id ?? null,
    guestToken,
  );
  if (!quoteRecord) {
    const owned = await getOwnedRecommendationQuote(
      id,
      user?.id ?? null,
      guestToken,
    );
    if (owned && user) {
      return (
        <QuoteExpiredRefresh
          quoteId={id}
          catalogHref="/cloud-servers"
          quoteBasePath="/cloud-servers/quote"
          refreshApiPath={`/api/cloud-servers/quotes/${id}/refresh`}
        />
      );
    }
    redirect("/cloud-servers?quote=expired");
  }

  const quote = toPublicRecommendationQuote(quoteRecord);
  const snapshot = quoteRecord.planSnapshot as Record<string, unknown>;
  const location = readyServerLocation(
    typeof snapshot.regionCode === "string"
      ? snapshot.regionCode
      : quoteRecord.plan.regionCode,
  ).label;
  const image = readyServerImageLabel(
    typeof snapshot.imageCode === "string"
      ? snapshot.imageCode
      : quoteRecord.plan.imageCode,
  );
  const deliveryConfiguration =
    quoteRecord.deliveryConfigurationSnapshot &&
    typeof quoteRecord.deliveryConfigurationSnapshot === "object" &&
    !Array.isArray(quoteRecord.deliveryConfigurationSnapshot)
      ? (quoteRecord.deliveryConfigurationSnapshot as Record<string, unknown>)
      : null;
  const serverName =
    typeof deliveryConfiguration?.serverName === "string"
      ? deliveryConfiguration.serverName
      : null;
  const lockedOsLabel =
    typeof deliveryConfiguration?.operatingSystem === "string"
      ? deliveryConfiguration.operatingSystem
      : image;
  const parchinContract = readParchinServiceSnapshot(
    quoteRecord.parchinServiceSnapshot,
  );
  const taxItem = quote.lineItems.find((item) => item.type === "TAX");
  const effectiveDiscount = effectiveTermDiscountLabel(quote.termDiscountBps);
  const ceilingDiscount = termDiscountCeilingLabel(quote.termMonths);
  const next = `/cloud-servers/quote/${quote.id}`;
  const wallet = user ? await getWalletForUser(user.id) : null;

  return (
    <section className="ready-quote-page page-view" aria-labelledby="ready-quote-title">
      <header className="ready-quote-heading">
        <div>
          <span className="eyebrow">
            <LockKeyhole size={15} aria-hidden="true" />
            قیمت قفل‌شده
          </span>
          <h1 id="ready-quote-title">{quote.title}</h1>
          <p>
            قیمت، ظرفیت، موقعیت و سیستم‌عامل این انتخاب تا پایان شمارش برای شما
            قفل است. مبلغ سرور فقط از کیف پول پرداخت می‌شود.
          </p>
        </div>
        <Link className="button button-quiet" href="/cloud-servers">
          تغییر سرور
        </Link>
      </header>

      <div className="ready-quote-layout">
        <article className="ready-quote-summary">
          <div className="ready-quote-badges">
            <span><MapPin size={14} aria-hidden="true" /> {location}</span>
            <span>
              <ShieldCheck size={14} aria-hidden="true" />{" "}
              {parchinContract
                ? `${parchinContract.title} · نسخه ${parchinContract.version.toLocaleString("fa-IR")}`
                : "پرچین"}
            </span>
          </div>

          <div className="ready-quote-resources">
            <span><small>پردازنده</small><strong dir="ltr">{quote.vcpu ?? "—"} vCPU</strong></span>
            <span><small>حافظه</small><strong dir="ltr">{quote.ramGb ?? "—"} GB</strong></span>
            <span><small>فضای دیسک</small><strong dir="ltr">{quote.storageGb ?? "—"} GB</strong></span>
            <span><small>موقعیت</small><strong>{location}</strong></span>
            <span><small>سیستم‌عامل</small><strong dir="ltr">{lockedOsLabel}</strong></span>
            {serverName ? (
              <span><small>نام سرور</small><strong dir="ltr">{serverName}</strong></span>
            ) : null}
            <span>
              <small>مدت</small>
              <strong>{quote.termMonths.toLocaleString("fa-IR")} ماه</strong>
            </span>
            {effectiveDiscount ? (
              <span>
                <small>تخفیف</small>
                <strong>{effectiveDiscount}</strong>
              </span>
            ) : ceilingDiscount ? (
              <span>
                <small>تخفیف دوره</small>
                <strong>{ceilingDiscount}</strong>
              </span>
            ) : null}
            {taxItem ? (
              <span>
                <small>مالیات</small>
                <strong>{formatTomanFa(BigInt(taxItem.amountRial))} تومان</strong>
              </span>
            ) : null}
            <span>
              <small>مبلغ قابل‌پرداخت</small>
              <strong>{formatTomanFa(quoteRecord.amountRial)} تومان</strong>
            </span>
            <span>
              <small>مبلغ تمدید</small>
              <strong>
                {formatTomanFa(quoteRecord.renewalAmountRial)} تومان
              </strong>
            </span>
            <span>
              <small>تحویل</small>
              <strong>ساخت و تحویل پس از بررسی سفارش توسط تیم ابرچین</strong>
            </span>
          </div>

          {parchinContract ? (
            <div className="ready-quote-parchin">
              <h2>{parchinContract.title}</h2>
              <p>
                نسخه {parchinContract.version.toLocaleString("fa-IR")} —{" "}
                {parchinContract.description}
              </p>
            </div>
          ) : null}
        </article>

        <aside className="ready-quote-checkout">
          {renewed === "1" ? (
            <p className="ready-quote-renewed">
              قیمت این انتخاب به‌روز و دوباره قفل شد؛ مشخصات سرورت حفظ شده است.
            </p>
          ) : null}
          {user ? (
            <OrderCheckoutPanel
              quoteId={quote.id}
              planTitle={quote.title}
              priceToman={formatTomanFa(quoteRecord.amountRial)}
              termMonths={quote.termMonths}
              termDiscountBps={quote.termDiscountBps}
              couponCode={quote.couponCode}
              lineItems={quote.lineItems}
              amountRial={quoteRecord.amountRial.toString()}
              walletBalanceRial={(wallet?.availableBalance ?? 0n).toString()}
              returnToPath={next}
              quoteBasePath="/cloud-servers/quote"
              expiresAt={quote.expiresAt}
              refreshApiPath={`/api/cloud-servers/quotes/${quote.id}/refresh`}
              serverSummary={{
                title: quote.title,
                locationLabel: location,
                vcpu: quote.vcpu,
                ramGb: quote.ramGb,
                storageGb: quote.storageGb,
                operatingSystem: lockedOsLabel,
                termMonths: quote.termMonths,
                serverName,
              }}
            />
          ) : (
            <div className="ready-quote-login">
              <p>
                پیش‌فاکتور قفل شد. برای دیدن موجودی کیف پول، مبلغ قابل‌پرداخت و
                ثبت سفارش همین انتخاب وارد شو.
              </p>
              <p className="ready-quote-login-legal">
                با ادامه،{" "}
                <Link href="/terms">شرایط استفاده</Link> و{" "}
                <Link href="/refund-policy">سیاست بازپرداخت</Link> را می‌پذیری.
              </p>
              <Link
                className="button button-primary"
                href={`/login?next=${encodeURIComponent(next)}`}
              >
                ورود و ادامه خرید
              </Link>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
