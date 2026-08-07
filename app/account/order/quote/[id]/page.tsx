import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { QuoteExpiredRefresh } from "@/components/quote/quote-expired-refresh";
import { PageHeader, SectionCard, StatusBadge } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { parchinPlanLabel, parchinPlanSummary } from "@/lib/parchin/catalog";
import {
  getActiveRecommendationQuote,
  getOwnedRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";
import { getWalletForUser } from "@/lib/wallet/ensure-wallet";

export const metadata: Metadata = {
  title: "تکمیل پیشنهاد | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RecommendationQuoteCheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerPage();
  const { id } = await params;

  const quoteRecord = await getActiveRecommendationQuote(id, user.id);
  if (!quoteRecord) {
    const owned = await getOwnedRecommendationQuote(id, user.id, null);
    if (owned) {
      return (
        <QuoteExpiredRefresh
          quoteId={id}
          catalogHref="/compass?resume=1"
          quoteBasePath="/account/order/quote"
          refreshApiPath={`/api/recommendations/quotes/${id}/refresh`}
        />
      );
    }
    redirect("/compass?resume=1");
  }
  const quote = toPublicRecommendationQuote(quoteRecord);
  const wallet = await getWalletForUser(user.id);
  const deliveryConfiguration =
    quoteRecord.deliveryConfigurationSnapshot &&
    typeof quoteRecord.deliveryConfigurationSnapshot === "object" &&
    !Array.isArray(quoteRecord.deliveryConfigurationSnapshot)
      ? (quoteRecord.deliveryConfigurationSnapshot as Record<string, unknown>)
      : null;
  const operatingSystem =
    typeof deliveryConfiguration?.operatingSystem === "string"
      ? deliveryConfiguration.operatingSystem
      : "—";
  const serverName =
    typeof deliveryConfiguration?.serverName === "string"
      ? deliveryConfiguration.serverName
      : null;
  const locationLabel =
    typeof deliveryConfiguration?.regionLabel === "string"
      ? deliveryConfiguration.regionLabel
      : typeof deliveryConfiguration?.region === "string"
        ? deliveryConfiguration.region
        : quoteRecord.providerRegion ?? "—";
  const returnToPath = `/account/order/quote/${quote.id}`;

  return (
    <>
      <PageHeader
        title={quote.title}
        description="این چینش از پاسخ‌های گفت‌وگوی تو ساخته شده و تا پایان شمارش برای تو قفل است. مبلغ فقط از کیف پول کسر می‌شود."
        actions={
          <Link href="/compass?resume=1" className="product-btn product-btn--quiet">
            اصلاح نیاز
          </Link>
        }
      />
      <SectionCard title="خلاصه پیشنهاد اختصاصی">
        <p style={{ marginTop: 0 }}>{quote.description}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <StatusBadge label={deliveryModeLabel[quote.deliveryMode]} tone="info" />
          {quote.vcpu ? <span className="product-tech">{quote.vcpu} vCPU</span> : null}
          {quote.ramGb ? <span className="product-tech">{quote.ramGb} GB RAM</span> : null}
          {quote.storageGb ? <span className="product-tech">{quote.storageGb} GB فضا</span> : null}
          <span className="product-tech">
            {quote.termMonths.toLocaleString("fa-IR")} ماهه{" "}
            {formatTomanFa(quoteRecord.amountRial)} تومان
          </span>
          <span className="product-tech">
            تمدید دستی {formatTomanFa(quoteRecord.renewalAmountRial)} تومان
          </span>
          {quote.termDiscountBps > 0 ? (
            <span className="product-tech">
              تخفیف {Math.round(quote.termDiscountBps / 100).toLocaleString("fa-IR")}٪
              {quote.couponCode ? ` (${quote.couponCode})` : ""}
            </span>
          ) : null}
          <span className="product-tech">
            {parchinPlanLabel(quote.parchinIncluded)}
          </span>
        </div>
        <p>{parchinPlanSummary(quote.parchinIncluded)}</p>
        <ul>
          {quote.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
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
      />
    </>
  );
}
