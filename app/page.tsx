import { ArrowLeft, Check, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { HomeStarter } from "@/components/home-starter";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <section className="home-page page-view" aria-labelledby="home-title">
      <div className="home-copy">
        <div className="eyebrow">
          <Sparkles size={15} aria-hidden="true" />
          زیرساخت ساده، آماده‌ی رشد
        </div>

        <h1 id="home-title">
          زیرساختت رو
          <span> سوار بر ابرها بساز.</span>
        </h1>

        <p className="home-lead">
          سرور مناسب را شفاف انتخاب کن، مشخصات را قبل از پرداخت قفل کن و ساخت، تحویل و نگهداری را از یک پنل جلو ببر.
        </p>

        <div className="home-actions">
          <Link className="button button-primary button-large" href="/cloud-servers">
            دیدن سرورهای قابل خرید
            <ArrowLeft size={19} aria-hidden="true" />
          </Link>
          <Link className="button button-quiet button-large" href="/compass">
            <Layers3 size={18} aria-hidden="true" />
            مطمئن نیستم؛ راهنمایی می‌خواهم
          </Link>
        </div>

        <div className="trust-line" aria-label="ویژگی‌های سرویس ابرچین">
          <span><Check size={15} aria-hidden="true" /> فقط پلن قابل خرید</span>
          <span><Check size={15} aria-hidden="true" /> قیمت قفل‌شده ۶۰ دقیقه‌ای</span>
          <span><ShieldCheck size={15} aria-hidden="true" /> تحویل امن و پرچین نسخه‌دار</span>
        </div>
      </div>

      <div className="home-starter-wrap">
        <HomeStarter />
      </div>
    </section>
  );
}
