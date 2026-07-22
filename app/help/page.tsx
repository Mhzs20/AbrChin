import { ArrowUpLeft, CircleHelp, Compass, Mail, MessageCircleMore } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FaqList } from "@/components/faq-list";

export const metadata: Metadata = {
  title: "راهنما و ارتباط | ابرچین",
  description: "برای انتخاب، انتقال یا راه‌اندازی زیرساخت با ابرچین در ارتباط باش.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return (
    <section className="help-page page-view" aria-labelledby="help-title">
      <div className="help-contact">
        <header className="page-heading">
          <div className="eyebrow"><MessageCircleMore size={15} aria-hidden="true" /> راهنما و ارتباط</div>
          <h1 id="help-title">قبل از خرید، حرف بزنیم.</h1>
          <p>برای انتخاب، انتقال یا شروع پروژه کنارتیم.</p>
        </header>

        <div className="contact-grid">
          <Link className="contact-card contact-primary" href="/compass">
            <span><Compass size={24} aria-hidden="true" /></span>
            <div><small>از کجا شروع کنم؟</small><strong>قطب‌نما رو شروع کن</strong></div>
            <ArrowUpLeft size={19} aria-hidden="true" />
          </Link>

          <a
            className="contact-card"
            href="mailto:hello@abrchin.ir?subject=%DA%AF%D9%81%D8%AA%E2%80%8C%D9%88%DA%AF%D9%88%20%D8%A8%D8%A7%20%D8%A7%D8%A8%D8%B1%DA%86%DB%8C%D9%86"
          >
            <span><Mail size={23} aria-hidden="true" /></span>
            <div><small>پروژه‌ام آماده‌ست</small><strong>ایمیل به ابرچین</strong></div>
            <ArrowUpLeft size={19} aria-hidden="true" />
          </a>
        </div>

        <div className="direct-email">
          <span className="live-dot" aria-hidden="true" />
          <span>جوابت رو یک آدم واقعی می‌ده.</span>
          <a href="mailto:hello@abrchin.ir" dir="ltr">hello@abrchin.ir</a>
        </div>
      </div>

      <aside className="faq-panel" aria-labelledby="faq-title">
        <div className="faq-panel-title">
          <span><CircleHelp size={20} aria-hidden="true" /></span>
          <div><small>جواب کوتاه</small><h2 id="faq-title">سؤال‌های پرتکرار</h2></div>
        </div>
        <FaqList />
      </aside>
    </section>
  );
}
