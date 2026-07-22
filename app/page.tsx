import { ArrowLeft, Check, Layers3, Sparkles } from "lucide-react";
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
          بگو چی می‌سازی؛
          <span> زیرساختش رو ابرچین می‌چینه.</span>
        </h1>

        <p className="home-lead">
          پیشنهاد می‌دیم، راه‌اندازی می‌کنیم و اگر بخوای مدیریتش هم با ماست.
        </p>

        <div className="home-actions">
          <Link className="button button-primary button-large" href="/compass">
            پیشنهادم رو بساز
            <ArrowLeft size={19} aria-hidden="true" />
          </Link>
          <Link className="button button-quiet button-large" href="/solutions">
            <Layers3 size={18} aria-hidden="true" />
            راهکارها رو ببین
          </Link>
        </div>

        <div className="trust-line" aria-label="ویژگی‌های سرویس ابرچین">
          <span><Check size={14} aria-hidden="true" /> شروع سریع</span>
          <span><Check size={14} aria-hidden="true" /> قابل ارتقا</span>
          <span><Check size={14} aria-hidden="true" /> مدیریت اختیاری</span>
        </div>
      </div>

      <div className="home-starter-wrap">
        <HomeStarter />
      </div>
    </section>
  );
}
