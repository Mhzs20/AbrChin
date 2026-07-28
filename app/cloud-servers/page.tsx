import { Cloud, Compass, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { QuickCloudPlans } from "@/components/quick-cloud-plans";
import { listPublicPlanOffers } from "@/lib/orders/plans";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "خرید سریع سرور ابری | ابرچین",
  description: "سه چینش واقعی و قیمت‌دار سرور ابری؛ انتخاب، ورود و پرداخت.",
  alternates: { canonical: "/cloud-servers" },
};

export const dynamic = "force-dynamic";

export default async function CloudServersPage() {
  const [plans, user] = await Promise.all([listPublicPlanOffers(), getCurrentUser()]);

  return (
    <section className="quick-buy-page page-view" aria-labelledby="quick-buy-title">
      <header className="quick-buy-heading">
        <div>
          <span className="eyebrow"><Cloud size={15} aria-hidden="true" /> خرید سریع سرور ابری</span>
          <h1 id="quick-buy-title">انتخاب کن، پرداخت کن، تحویل بگیر.</h1>
          <p>سه چینش آماده با قیمت روشن؛ بدون پرسش‌های اضافه و بدون نمایش تأمین‌کننده.</p>
        </div>
        <Link className="button button-quiet" href="/compass">
          <Compass size={16} aria-hidden="true" />
          برای انتخاب کمک می‌خوام
        </Link>
      </header>

      <div className="quick-buy-strip">
        <span><Zap size={15} aria-hidden="true" /> قیمت قبل از ورود</span>
        <span>ورود فقط بعد از انتخاب</span>
        <span>تحویل و مدیریت از پنل ابرچین</span>
      </div>

      <QuickCloudPlans plans={plans} signedIn={Boolean(user)} />
    </section>
  );
}
