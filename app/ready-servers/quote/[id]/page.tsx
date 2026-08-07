import { LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { QuoteCountdown } from "@/components/quote-countdown";
import { QuoteExpiredRefresh } from "@/components/quote/quote-expired-refresh";
import {
  readyServerImageLabel,
  readyServerLocation,
} from "@/lib/cloud-servers/catalog";
import {
  accessMethodLabel,
  effectiveTermDiscountLabel,
  termDiscountCeilingLabel,
} from "@/lib/labels/customer";
import { formatTomanFa } from "@/lib/money";
import { readParchinServiceSnapshot } from "@/lib/parchin/service-contract";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  getActiveReadyServerQuote,
  getOwnedRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";
import { getWalletForUser } from "@/lib/wallet/ensure-wallet";

export const metadata: Metadata = {
  title: "پیش‌فاکتور سرور آماده | ابرچین",
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
  const record = await getActiveReadyServerQuote(
    id,
    user?.id ?? null,
    guestToken,
  );
  if (!record) {
    const owned = await getOwnedRecommendationQuote(
      id,
      user?.id ?? null,
      guestToken,
    );
    if (owned && user) {
      return (
        <QuoteExpiredRefresh
          quoteId={id}
          catalogHref="/ready-servers"
          quoteBasePath="/ready-servers/quote"
          refreshApiPath={`/api/ready-servers/quotes/${id}/refresh`}
        />
      );
    }
    redirect("/ready-servers?quote=expired");
  }
  const wallet = user ? await getWalletForUser(user.id) : null;

  const quote = toPublicRecommendationQuote(record);
  const snapshot = record.planSnapshot as Record<string, unknown>;
  const location = readyServerLocation(
    typeof snapshot.regionCode === "string"
      ? snapshot.regionCode
      : record.plan.regionCode,
  ).label;
  const image = readyServerImageLabel(
    typeof snapshot.imageCode === "string"
      ? snapshot.imageCode
      : record.plan.imageCode,
  );
  const deliveryConfiguration =
    record.deliveryConfigurationSnapshot &&
    typeof record.deliveryConfigurationSnapshot === "object" &&
    !Array.isArray(record.deliveryConfigurationSnapshot)
      ? (record.deliveryConfigurationSnapshot as Record<string, unknown>)
      : null;
  const serverName =
    typeof deliveryConfiguration?.serverName === "string"
      ? deliveryConfiguration.serverName
      : null;
  const lockedOsLabel =
    typeof deliveryConfiguration?.operatingSystem === "string"
      ? deliveryConfiguration.operatingSystem
      : image;
  const accessMethod =
    typeof deliveryConfiguration?.accessMethod === "string"
      ? deliveryConfiguration.accessMethod
      : null;
  const parchinContract = readParchinServiceSnapshot(
    record.parchinServiceSnapshot,
  );
  const taxItem = quote.lineItems.find((item) => item.type === "TAX");
  const effectiveDiscount = effectiveTermDiscountLabel(quote.termDiscountBps);
  const ceilingDiscount = termDiscountCeilingLabel(quote.termMonths);
  const next = `/ready-servers/quote/${quote.id}`;

  return (
    <section className="ready-quote-page page-view" aria-labelledby="quote-title">
      <header className="ready-quote-heading">
        <div>
          <span className="eyebrow">
            <LockKeyhole size={15} aria-hidden="true" />
            قیمت قفل‌شده
          </span>
          <h1 id="quote-title">{quote.title}</h1>
          <p>
            قیمت، ظرفیت، موقعیت، سیستم‌عامل و پرچین برای چند دقیقه قفل شده‌اند.
          </p>
        </div>
        <Link className="button button-quiet" href="/ready-servers">
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
                : "پرچین اجباری"}
            </span>
          </div>
          <div className="ready-quote-resources">
            <span><small>پردازنده</small><strong dir="ltr">{quote.vcpu ?? "—"} vCPU</strong></span>
            <span><small>حافظه</small><strong dir="ltr">{quote.ramGb ?? "—"} GB</strong></span>
            <span><small>فضای دیسک</small><strong dir="ltr">{quote.storageGb ?? "—"} GB</strong></span>
            <span><small>موقعیت</small><strong>{location}</strong></span>
            <span><small>سیستم‌عامل</small><strong dir="ltr">{lockedOsLabel}</strong></span>
            {accessMethod ? (
              <span>
                <small>روش دسترسی</small>
                <strong>{accessMethodLabel(accessMethod)}</strong>
              </span>
            ) : null}
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
              <small>تحویل</small>
              <strong>
                تحویل پس از تأیید ظرفیت؛ در صورت موجود بودن ظرفیت معمولاً سریع
                انجام می‌شود
              </strong>
            </span>
          </div>

          {parchinContract ? (
            <div className="ready-quote-parchin">
              <h2>{parchinContract.title}</h2>
              <p>
                نسخه {parchinContract.version.toLocaleString("fa-IR")} —{" "}
                {parchinContract.description}
              </p>
              <h3>شامل می‌شود</h3>
              <ul>
                {parchinContract.includedServices.map((item) => (
                  <li key={`in-${item}`}>{item}</li>
                ))}
              </ul>
              <h3>شامل نمی‌شود</h3>
              <ul>
                {parchinContract.excludedServices.map((item) => (
                  <li key={`ex-${item}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul>{quote.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </article>

        <aside className="ready-quote-checkout">
          <span>
            مبلغ {quote.termMonths.toLocaleString("fa-IR")} ماهه
            {effectiveDiscount ? ` · ${effectiveDiscount}` : ""}
          </span>
          <strong>
            {formatTomanFa(record.amountRial)}
            <small> تومان</small>
          </strong>
          <p>
            مبلغ تمدید: {formatTomanFa(record.renewalAmountRial)} تومان
          </p>
          {taxItem ? (
            <p>مالیات: {formatTomanFa(BigInt(taxItem.amountRial))} تومان</p>
          ) : null}
          {renewed === "1" ? (
            <p className="ready-quote-renewed">
              قیمت این انتخاب به‌روز و دوباره قفل شد؛ مشخصات سرورت حفظ شده است.
            </p>
          ) : null}
          <p><QuoteCountdown expiresAt={quote.expiresAt} /></p>
          {user ? (
            <OrderCheckoutPanel
              quoteId={quote.id}
              planTitle={quote.title}
              priceToman={formatTomanFa(record.amountRial)}
              termMonths={quote.termMonths}
              termDiscountBps={quote.termDiscountBps}
              couponCode={quote.couponCode}
              lineItems={quote.lineItems}
              amountRial={record.amountRial.toString()}
              walletBalanceRial={(wallet?.availableBalance ?? 0n).toString()}
              returnToPath={next}
              quoteBasePath="/ready-servers/quote"
            />
          ) : (
            <div className="ready-quote-login">
              <p>
                پیش‌فاکتور حفظ شد. برای پرداخت و ادامه همین انتخاب وارد شو.
              </p>
              <Link
                className="button button-primary"
                href={`/login?next=${encodeURIComponent(next)}`}
              >
                ورود یا ثبت‌نام
              </Link>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
