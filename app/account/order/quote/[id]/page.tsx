import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { QuoteCountdown } from "@/components/quote-countdown";
import { PageHeader, SectionCard, StatusBadge } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { parchinPlanLabel, parchinPlanSummary } from "@/lib/parchin/catalog";
import {
  getActiveRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";

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
  if (!quoteRecord) redirect("/compass?resume=1");
  const quote = toPublicRecommendationQuote(quoteRecord);

  return (
    <>
      <PageHeader
        title={quote.title}
        description="این چینش از پاسخ‌های گفت‌وگوی تو ساخته شده و تا پایان شمارش قفل است."
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
        <p>
          <strong><QuoteCountdown expiresAt={quote.expiresAt} /></strong>
        </p>
      </SectionCard>
      <OrderCheckoutPanel
        quoteId={quote.id}
        planTitle={quote.title}
        priceToman={formatTomanFa(quoteRecord.amountRial)}
        termMonths={quote.termMonths}
        termDiscountBps={quote.termDiscountBps}
        couponCode={quote.couponCode}
        lineItems={quote.lineItems}
      />
    </>
  );
}
