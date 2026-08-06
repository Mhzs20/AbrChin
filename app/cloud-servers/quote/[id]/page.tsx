import { LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { QuoteCountdown } from "@/components/quote-countdown";
import {
  readyServerImageLabel,
  readyServerLocation,
} from "@/lib/cloud-servers/catalog";
import { prisma } from "@/lib/db";
import { formatTomanFa } from "@/lib/money";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { parchinBase } from "@/lib/parchin/catalog";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  getActiveCloudServerQuote,
  refreshRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Quote سرور آماده | ابرچین",
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
  const quoteRecord = await getActiveCloudServerQuote(
    id,
    user?.id ?? null,
    user ? null : await getRecommendationGuestToken(),
  );
  if (!quoteRecord) {
    // Keep the customer's configuration across gateway round trips: renew the
    // expired quote with the same locked delivery configuration when possible.
    let replacementId: string | null = null;
    if (user) {
      try {
        const replacement = await refreshRecommendationQuote({
          quoteId: id,
          userId: user.id,
        });
        replacementId = replacement?.id ?? null;
      } catch {
        replacementId = null;
      }
    }
    if (replacementId) {
      redirect(`/cloud-servers/quote/${replacementId}?renewed=1`);
    }
    redirect("/cloud-servers?quote=expired");
  }

  // Launch Amendment 1.L: storefront checkout is prepaid wallet debit.
  // Repair leftover PAYG plans so order creation is not rejected.
  if (quoteRecord.plan.billingModel === "PAYG_WALLET") {
    await prisma.infrastructurePlan.update({
      where: { id: quoteRecord.plan.id },
      data: {
        billingModel: "PREPAID_TERM",
        billingPolicyVersionId: null,
      },
    });
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
  const next = `/cloud-servers/quote/${quote.id}`;
  const wallet = user ? await ensureWalletForUser(user.id) : null;

  return (
    <section className="ready-quote-page page-view" aria-labelledby="ready-quote-title">
      <header className="ready-quote-heading">
        <div>
          <span className="eyebrow">
            <LockKeyhole size={15} aria-hidden="true" />
            Quote قفل‌شده
          </span>
          <h1 id="ready-quote-title">{quote.title}</h1>
          <p>
            قیمت، ظرفیت، موقعیت و سیستم‌عامل این انتخاب برای ۱۰ دقیقه Snapshot
            شده‌اند.
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
            <span><ShieldCheck size={14} aria-hidden="true" /> {parchinBase.title}</span>
          </div>

          <div className="ready-quote-resources">
            <span><small>پردازنده</small><strong dir="ltr">{quote.vcpu ?? "—"} vCPU</strong></span>
            <span><small>حافظه</small><strong dir="ltr">{quote.ramGb ?? "—"} GB</strong></span>
            <span><small>فضای دیسک</small><strong dir="ltr">{quote.storageGb ?? "—"} GB</strong></span>
            <span><small>سیستم‌عامل</small><strong dir="ltr">{lockedOsLabel}</strong></span>
            {serverName ? (
              <span><small>نام سرور</small><strong dir="ltr">{serverName}</strong></span>
            ) : null}
          </div>

          <ul>
            {quote.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </article>

        <aside className="ready-quote-checkout">
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
              priceToman={formatTomanFa(quoteRecord.amountRial)}
              termMonths={quote.termMonths}
              termDiscountBps={quote.termDiscountBps}
              couponCode={quote.couponCode}
              lineItems={quote.lineItems}
              amountRial={quoteRecord.amountRial.toString()}
              walletBalanceRial={(wallet?.availableBalance ?? 0n).toString()}
              returnToPath={next}
              quoteBasePath="/cloud-servers/quote"
            />
          ) : (
            <div className="ready-quote-login">
              <p>
                Quote قفل شد. برای دیدن موجودی کیف پول، مبلغ قابل‌پرداخت و ثبت
                سفارش همین انتخاب وارد شو.
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
