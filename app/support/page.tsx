import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";

import { SupportSelector } from "@/components/support-selector";

export const metadata: Metadata = {
  title: "پرچین و سطح همراهی | ابرچین",
  description: "دامنه پرچین پایه و مسئولیت‌های تحویل سرور ابری ابرچین.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <section className="support-page page-view" aria-labelledby="support-title">
      <header className="page-heading centered-heading">
        <div className="eyebrow"><HeartHandshake size={15} aria-hidden="true" /> سطح همراهی</div>
        <h1 id="support-title">هر سرور، همراه با پرچین پایه.</h1>
        <p>دامنه تحویل امن و مسئولیت‌ها پیش از خرید روشن است؛ قابلیت پنهانی وعده داده نمی‌شود.</p>
      </header>
      <SupportSelector />
    </section>
  );
}
