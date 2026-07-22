import { ArrowLeft, Layers3, LineChart, ShieldCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "درباره ابرچین",
  description: "ابرچین پیچیدگی زیرساخت را می‌چیند تا تیم‌ها ساده‌تر شروع کنند و آماده رشد بمانند.",
  alternates: { canonical: "/about" },
};

const roadmap = [
  { time: "۰ تا ۶ ماه", title: "شروع هوشمند", text: "پیشنهاد، خرید و راه‌اندازی همراه با تیم ابرچین", active: true },
  { time: "۶ تا ۱۲ ماه", title: "پنل یکپارچه", text: "سرویس، پرداخت و پشتیبانی در یک تجربه" },
  { time: "۱۲ تا ۱۸ ماه", title: "مدیریت خودکار", text: "پایش، بکاپ و ارتقای ساده‌تر" },
  { time: "۱۸ تا ۲۴ ماه", title: "ابر ابرچین", text: "ظرفیت اختصاصی، API و مقیاس گسترده‌تر" },
];

export default function AboutPage() {
  return (
    <section className="about-page page-view" aria-labelledby="about-title">
      <div className="about-hero">
        <div className="about-copy">
          <div className="eyebrow"><Sparkles size={15} aria-hidden="true" /> ابرچین؛ زیرساخت روی ابرها</div>
          <h1 id="about-title">زیرساخت باید محکم باشه، نه سنگین.</h1>
          <p>
            ابرچین از نیازت شروع می‌کنه، گزینه‌ها رو می‌سنجه و ابرها رو طوری می‌چینه که ساده شروع کنی، با پرچین امن ادامه بدی و برای رشد به بن‌بست نخوری.
          </p>
          <Link className="button button-primary" href="/compass">
            زیرساخت من رو بچین
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        </div>

        <div className="about-visual" aria-hidden="true">
          <span className="about-halo halo-one" />
          <span className="about-halo halo-two" />
          <Image src="/assets/abrchin-symbol.svg" alt="" width={150} height={126} />
          <span className="about-caption">محکم، بدون سنگین شدن.</span>
        </div>
      </div>

      <div className="brand-principles">
        <article><span><Layers3 size={22} aria-hidden="true" /></span><div><h2>ساده شروع کن</h2><p>از نیاز شروع می‌کنیم، نه اسم تکنولوژی.</p></div></article>
        <article><span><ShieldCheck size={22} aria-hidden="true" /></span><div><h2>با پرچین امن بمون</h2><p>امن‌سازی، پایش و بکاپ به‌اندازه‌ی نیازت.</p></div></article>
        <article><span><LineChart size={22} aria-hidden="true" /></span><div><h2>بدون بن‌بست رشد کن</h2><p>برای قدم بعد از امروز جا می‌ذاریم.</p></div></article>
      </div>

      <section className="roadmap-card" aria-labelledby="roadmap-title">
        <div className="roadmap-title">
          <div><span>نقشه‌ی توسعه‌ی ۲۴ ماهه</span><h2 id="roadmap-title">از همراهی انسانی تا ابر یکپارچه</h2></div>
          <span className="roadmap-status"><span className="live-dot" /> امروز اینجاییم</span>
        </div>
        <div className="roadmap-line">
          {roadmap.map((phase, index) => (
            <article className={phase.active ? "active" : ""} key={phase.time}>
              <span className="phase-dot">{toPersianDigits(index + 1)}</span>
              <small>{phase.time}</small>
              <h3>{phase.title}</h3>
              <p>{phase.text}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function toPersianDigits(value: number) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}
