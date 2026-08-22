import { LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { QuoteExpiredRefresh } from "@/components/quote/quote-expired-refresh";
import { PageHeader, SectionCard } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { formatTomanFa } from "@/lib/money";
import { readParchinServiceSnapshot } from "@/lib/parchin/service-contract";
import {
  getActiveRecommendationQuote,
  getOwnedRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";
import { getWalletForUser } from "@/lib/wallet/ensure-wallet";
import { specGbFa, specVcpuFa } from "@/lib/labels/customer";

export const metadata: Metadata = {
  title: "بررسی و پرداخت سفارش | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountQuoteCheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerPage();
  const { id } = await params;
  const quoteRecord = await getActiveRecommendationQuote(id, user.id, null);

  if (!quoteRecord) {
    const owned = await getOwnedRecommendationQuote(id, user.id, null);
    if (owned) {
      return (
        <QuoteExpiredRefresh
          quoteId={id}
          catalogHref="/cloud-servers"
          quoteBasePath="/account/order/quote"
          refreshApiPath={`/api/recommendations/quotes/${id}/refresh`}
        />
      );
    }
    redirect("/cloud-servers?quote=unavailable");
  }

  const quote = toPublicRecommendationQuote(quoteRecord);
  const wallet = await getWalletForUser(user.id);
  const delivery =
    quoteRecord.deliveryConfigurationSnapshot &&
    typeof quoteRecord.deliveryConfigurationSnapshot === "object" &&
    !Array.isArray(quoteRecord.deliveryConfigurationSnapshot)
      ? (quoteRecord.deliveryConfigurationSnapshot as Record<string, unknown>)
      : null;
  const operatingSystem =
    typeof delivery?.operatingSystem === "string"
      ? delivery.operatingSystem
      : quoteRecord.plan.imageCode;
  const serverName =
    typeof delivery?.serverName === "string" ? delivery.serverName : null;
  const locationLabel =
    typeof delivery?.regionLabel === "string"
      ? delivery.regionLabel
      : typeof delivery?.region === "string"
        ? delivery.region
        : quoteRecord.providerRegion ?? quoteRecord.plan.regionCode;
  const parchin = readParchinServiceSnapshot(quoteRecord.parchinServiceSnapshot);
  const returnToPath = `/account/order/quote/${quote.id}`;

  return (
    <>
      <PageHeader
        title="بررسی نهایی و پرداخت"
        description="مشخصات، مدت و مبلغ این سفارش تا پایان شمارش تغییر نمی‌کند."
        actions={
          <Link href="/cloud-servers" className="product-btn product-btn--quiet">
            تغییر انتخاب
          </Link>
        }
      />

      <div className="account-quote-layout">
        <SectionCard title={quote.title}>
          <div className="account-quote-lock">
            <LockKeyhole size={18} aria-hidden="true" />
            <div>
              <strong>قرارداد خرید قفل شد</strong>
              <span>قیمت و مشخصات برای ۶۰ دقیقه ثابت است.</span>
            </div>
          </div>

          <div className="account-quote-badges">
            <span><MapPin size={14} aria-hidden="true" /> {locationLabel}</span>
            <span>
              <ShieldCheck size={14} aria-hidden="true" />
              {parchin ? `${parchin.title} · نسخه ${parchin.version.toLocaleString("fa-IR")}` : "پرچین"}
            </span>
          </div>

          <dl className="account-quote-specs">
            <div><dt>پردازنده</dt><dd>{specVcpuFa(quote.vcpu)}</dd></div>
            <div><dt>حافظه</dt><dd>{specGbFa(quote.ramGb)}</dd></div>
            <div><dt>دیسک</dt><dd>{specGbFa(quote.storageGb)}</dd></div>
            <div><dt>سیستم‌عامل</dt><dd dir="ltr">{operatingSystem}</dd></div>
            <div><dt>نام سرور</dt><dd dir="ltr">{serverName ?? "—"}</dd></div>
            <div><dt>مدت</dt><dd>{quote.termMonths.toLocaleString("fa-IR")} ماه</dd></div>
          </dl>

          {parchin ? (
            <div className="account-quote-parchin">
              <strong>{parchin.subtitle}</strong>
              <p>{parchin.description}</p>
              <small>زمان پاسخ: {parchin.firstResponseTarget}</small>
            </div>
          ) : null}

          {quote.reasons.length > 0 ? (
            <details className="account-quote-reasons">
              <summary>چرا این انتخاب پیشنهاد شده؟</summary>
              <ul>{quote.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </details>
          ) : null}
        </SectionCard>

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
          returnToPath={returnToPath}
          quoteBasePath="/account/order/quote"
          expiresAt={quote.expiresAt}
          refreshApiPath={`/api/recommendations/quotes/${quote.id}/refresh`}
          serverSummary={{
            title: quote.title,
            locationLabel,
            vcpu: quote.vcpu,
            ramGb: quote.ramGb,
            storageGb: quote.storageGb,
            operatingSystem,
            termMonths: quote.termMonths,
            serverName,
          }}
          showServerSummary={false}
        />
      </div>
    </>
  );
}
