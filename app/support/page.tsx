import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";

import { SupportSelector } from "@/components/support-selector";

export const metadata: Metadata = {
  title: "سطح همراهی | ابرچین",
  description: "زیرساخت خام، آماده‌به‌کار یا مدیریت‌شده؛ سطح همراهی مناسب خودت را انتخاب کن.",
  alternates: { canonical: "/support" },
};

export default function SupportPage() {
  return (
    <section className="support-page page-view" aria-labelledby="support-title">
      <header className="page-heading centered-heading">
        <div className="eyebrow"><HeartHandshake size={15} aria-hidden="true" /> سطح همراهی</div>
        <h1 id="support-title">هرچقدر لازم داری، کنارتیم.</h1>
        <p>خام، آماده یا مدیریت‌شده؛ کنترلش با توئه.</p>
      </header>
      <SupportSelector />
    </section>
  );
}
