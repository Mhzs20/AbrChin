import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionCard } from "@/components/product";

export const metadata: Metadata = {
  title: "راهنما و پشتیبانی | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export default function AccountSupportPage() {
  return (
    <>
      <PageHeader title="راهنما و پشتیبانی" description="راه‌های ارتباطی و سوالات متداول" />
      <SectionCard title="ارتباط با پشتیبانی">
        <ul style={{ margin: 0, paddingRight: 18, display: "grid", gap: 8 }}>
          <li>ایمیل: <span className="product-tech">support@abrchin.ir</span></li>
          <li>ساعات پاسخ‌گویی: شنبه تا پنج‌شنبه، ۹ تا ۱۸</li>
        </ul>
      </SectionCard>
      <SectionCard title="راهنما">
        <p>برای راهنمای شروع و انتخاب سرویس مناسب:</p>
        <Link href="/help" className="product-btn product-btn--primary">
          مراجعه به راهنمای ابرچین
        </Link>
      </SectionCard>
      <SectionCard title="سوالات متداول">
        <p><strong>چقدر طول می‌کشد تا سرور آماده شود؟</strong></p>
        <p>پس از پرداخت و تأمین زیرساخت، آماده‌سازی معمولاً چند دقیقه زمان می‌برد.</p>
        <p><strong>شارژ کیف پول چگونه انجام می‌شود؟</strong></p>
        <p>از بخش کیف پول می‌توانید با درگاه‌های فعال شارژ کنید.</p>
      </SectionCard>
    </>
  );
}
