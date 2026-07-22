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
          ابرچین ابرها رو طوری می‌چینه که بشه روشون محکم ساخت؛ ساده شروع کنی، با پرچین امن ادامه بدی و بدون بن‌بست رشد کنی.
        </p>

        <div className="home-actions">
          <Link className="button button-primary button-large" href="/compass">
            زیرساخت من رو بچین
            <ArrowLeft size={19} aria-hidden="true" />
          </Link>
          <Link className="button button-quiet button-large" href="/solutions">
            <Layers3 size={18} aria-hidden="true" />
            راهکارها رو ببین
          </Link>
        </div>

        <div className="trust-line" aria-label="ویژگی‌های سرویس ابرچین">
          <span><Check size={15} aria-hidden="true" /> تأیید قبل از خرید</span>
          <span><Check size={15} aria-hidden="true" /> ارتقا بدون بن‌بست</span>
          <span><ShieldCheck size={15} aria-hidden="true" /> امنیت و مراقبت با پرچین</span>
        </div>
      </div>

      <div className="home-starter-wrap">
        <HomeStarter />
      </div>
    </section>
  );
}
