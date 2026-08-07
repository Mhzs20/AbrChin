import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageNav } from "@/components/legal-page-nav";

export const metadata: Metadata = {
  title: "سیاست بازپرداخت | ابرچین",
  description:
    "قواعد بازپرداخت سفارش و شارژ کیف پول در ابرچین؛ بدون وعده بازپرداخت خودکار.",
  alternates: { canonical: "/refund-policy" },
  robots: { index: true, follow: true },
};

export default function RefundPolicyPage() {
  return (
    <section className="legal-page page-view" aria-labelledby="refund-title">
      <header className="page-heading">
        <div className="eyebrow">
          <Receipt size={15} aria-hidden="true" /> بازپرداخت
        </div>
        <h1 id="refund-title">سیاست بازپرداخت</h1>
        <p>
          این صفحه قواعد عملی بازپرداخت در محصول فعلی را بیان می‌کند. بازپرداخت
          خودکار یا تضمینی برای همه سفارش‌ها وعده داده نمی‌شود.
        </p>
      </header>

      <LegalPageNav current="/refund-policy" />

      <div className="legal-prose">
        <h2>۱. اصل کلی</h2>
        <p>
          خرید سرور دوره‌ای پیش‌پرداخت است. پرداخت موفق سفارش را ثبت می‌کند اما
          ساخت و تحویل فقط پس از تأییدهای ابرچین انجام می‌شود. بازپرداخت یک اقدام
          کنترل‌شده است، نه نتیجه خودکار هر اختلاف یا تأخیر.
        </p>

        <h2>۲. شارژ کیف پول</h2>
        <p>
          شارژ موفق کیف پول در ledger ثبت می‌شود. اگر مبلغ شارژ مصرف شده باشد،
          بازپرداخت خودکار انجام نمی‌شود و نیاز به بررسی دستی دارد. بازگشت بانکی
          درگاه ممکن است جدا از اعتبار کیف پول داخلی باشد و در همه حالات تضمین
          نشده است.
        </p>

        <h2>۳. سفارش سرور</h2>
        <p>
          تا قبل از ساخت یا در شرایطی که منابع ساخته نشده و تیم ابرچین بازپرداخت
          را مجاز بداند، مبلغ ممکن است به کیف پول داخلی برگردد. برای سرویس
          دوره‌ای پیش‌پرداخت فعال، مشتری می‌تواند لغو را با پیش‌نمایش مصرف‌شده و
          مبلغ قابل‌بازگشت شروع کند؛ بازگشت فقط به کیف پول ابرچین است و پس از
          خاتمه قطعی سرور یک‌بار ثبت می‌شود. محاسبهٔ بخش مصرف‌شده همان روش
          شناسایی مستقیم دوره در حسابداری ابرچین است. بازگشت بانکی خودکار انجام
          نمی‌شود.
        </p>

        <h2>۴. آنچه وعده داده نمی‌شود</h2>
        <p>
          ابرچین در این نسخه SLA نقدی، جریمه قطعی، یا بازپرداخت درصدی بر اساس
          downtime منتشرنشده ارائه نمی‌کند. محدودیت‌های پرچین و دامنه خدمات در{" "}
          <Link href="/service-policy">سیاست خدمات</Link> آمده است.
        </p>

        <h2>۵. درخواست بررسی</h2>
        <p>
          برای ثبت درخواست، از{" "}
          <Link href="/account/support">پشتیبانی حساب</Link> با دسته «پرداخت و
          کیف پول» استفاده کنید یا به{" "}
          <a href="mailto:support@abrchin.ir" dir="ltr">
            support@abrchin.ir
          </a>{" "}
          بنویسید. مشخصات ثبتی شرکت پس از تأیید بنیان‌گذار تکمیل می‌شود.
        </p>

        <h2>۶. پیوندها</h2>
        <p>
          همچنین ببینید: <Link href="/terms">شرایط استفاده</Link> و{" "}
          <Link href="/privacy">حریم خصوصی</Link>.
        </p>
      </div>
    </section>
  );
}
