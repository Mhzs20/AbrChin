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
import { formatTomanFa } from "@/lib/money";
import { getRecommendationGuestToken } from "@/lib/recommendation/guest-session-cookie";
import {
  getActiveReadyServerQuote,
  refreshRecommendationQuote,
  toPublicRecommendationQuote,
} from "@/lib/recommendation/quote-service";
import { getCurrentUser } from "@/lib/session";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

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
  const record = await getActiveReadyServerQuote(
    id,
    user?.id ?? null,
    user ? null : await getRecommendationGuestToken(),
  );
  if (!record) {
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
      redirect(`/ready-servers/quote/${replacementId}?renewed=1`);
    }
    redirect("/ready-servers?quote=expired");
  }
  const wallet = user ? await ensureWalletForUser(user.id) : null;

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
  const next = `/ready-servers/quote/${quote.id}`;

  return (
    <section className="ready-quote-page page-view" aria-labelledby="quote-title">
      <header className="ready-quote-heading">
        <div>
          <span className="eyebrow">
            <LockKeyhole size={15} aria-hidden="true" />
            Quote قفل‌شده
          </span>
          <h1 id="quote-title">{quote.title}</h1>
          <p>قیمت، ظرفیت، موقعیت، Image و پرچین برای ۱۰ دقیقه قفل شده‌اند.</p>
        </div>
        <Link className="button button-quiet" href="/ready-servers">
          تغییر سرور
        </Link>
      </header>

      <div className="ready-quote-layout">
        <article className="ready-quote-summary">
          <div className="ready-quote-badges">
            <span><MapPin size={14} aria-hidden="true" /> {location}</span>
            <span><ShieldCheck size={14} aria-hidden="true" /> پرچین اجباری</span>
          </div>
          <div className="ready-quote-resources">
            <span><small>پردازنده</small><strong dir="ltr">{quote.vcpu ?? "—"} vCPU</strong></span>
            <span><small>حافظه</small><strong dir="ltr">{quote.ramGb ?? "—"} GB</strong></span>
            <span><small>فضای دیسک</small><strong dir="ltr">{quote.storageGb ?? "—"} GB</strong></span>
            <span><small>سیستم‌عامل</small><strong dir="ltr">{image}</strong></span>
          </div>
          <ul>{quote.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </article>

        <aside className="ready-quote-checkout">
          <span>
            مبلغ {quote.termMonths.toLocaleString("fa-IR")} ماهه
            {quote.termDiscountBps > 0
              ? ` با تخفیف ${Math.round(quote.termDiscountBps / 100).toLocaleString("fa-IR")}٪`
              : ""}
          </span>
          <strong>
            {formatTomanFa(record.amountRial)}
            <small> تومان</small>
          </strong>
          <p>
            تمدید دستی فعلی: {formatTomanFa(record.renewalAmountRial)} تومان
          </p>
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
              <p>Quote حفظ شد. برای پرداخت و ادامه همین انتخاب وارد شو.</p>
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
