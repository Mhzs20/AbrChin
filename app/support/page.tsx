import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";

import { SupportSelector } from "@/components/support-selector";

export const metadata: Metadata = {
  title: "سطح همراهی | ابرچین",
  description: "سرور خام یا همراه ابرچین؛ دامنه مسئولیت هر مسیر را پیش از خرید مقایسه کن.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <section className="support-page page-view" aria-labelledby="support-title">
      <header className="page-heading centered-heading">
        <div className="eyebrow"><HeartHandshake size={15} aria-hidden="true" /> سطح همراهی</div>
        <h1 id="support-title">کنترل دست تو؛ همراهی با ما.</h1>
        <p>بین سرور خام و تحویل با پرچین پایه انتخاب کن؛ هیچ قابلیت پنهانی فرض نمی‌شه.</p>
      </header>
      <SupportSelector />
    </section>
  );
}
