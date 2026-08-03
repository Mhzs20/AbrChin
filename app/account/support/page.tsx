import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionCard } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "راهنما و پشتیبانی | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export default async function AccountSupportPage() {
  await requireCustomerPage();

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
        <p>
          برای سرور ابری، پس از بررسی اعتبار Wallet و تأیید اول Admin،
          آماده‌سازی کنترل‌شده شروع می‌شود. زمان دقیق به Provider و وضعیت
          Resource بستگی دارد.
        </p>
        <p><strong>شارژ کیف پول چگونه انجام می‌شود؟</strong></p>
        <p>
          از بخش Wallet با درگاه فعال شارژ می‌کنید. شارژ موفق فقط موجودی را
          افزایش می‌دهد و به‌تنهایی سرور نمی‌سازد.
        </p>
        <p><strong>هزینه سرور ابری چگونه کم می‌شود؟</strong></p>
        <p>
          مصرف بر اساس ResourceVersion و Rate نسخه‌دار محاسبه و در دوره
          ساعتی یا روزانه از Wallet تسویه می‌شود. Estimate ممکن است با
          Traffic یا Add-on قابل‌اندازه‌گیری Invoice نهایی تفاوت داشته باشد.
        </p>
      </SectionCard>
    </>
  );
}
