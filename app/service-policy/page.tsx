import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageNav } from "@/components/legal-page-nav";

export const metadata: Metadata = {
  title: "سیاست خدمات | ابرچین",
  description:
    "دامنه خدمات ابرچین، پرچین، تحویل کنترل‌شده و محدودیت‌های پشتیبانی.",
  alternates: { canonical: "/service-policy" },
  robots: { index: true, follow: true },
};

export default function ServicePolicyPage() {
  return (
    <section className="legal-page page-view" aria-labelledby="service-policy-title">
      <header className="page-heading">
        <div className="eyebrow">
          <HeartHandshake size={15} aria-hidden="true" /> سیاست خدمات
        </div>
        <h1 id="service-policy-title">سیاست خدمات ابرچین</h1>
        <p>
          این سند مرز تعهد قابل‌اتکا در فاز فعلی را مشخص می‌کند؛ هر وعده عملیاتی
          فقط وقتی معتبر است که در قرارداد همان سطح پرچین آمده باشد.
        </p>
      </header>

      <LegalPageNav current="/service-policy" />

      <div className="legal-prose">
        <h2>۱. آنچه ابرچین ارائه می‌کند</h2>
        <p>
          انتخاب و خرید سرور ابری با دوره ماهانه پیش‌پرداخت، شارژ کیف پول، ثبت
          سفارش، پیگیری وضعیت «در حال ساخت»، و پس از تأیید تحویل ابرچین دسترسی به
          مشخصات سرویس.
        </p>

        <h2>۲. جریان تأیید</h2>
        <p>
          ساخت منابع پس از تأیید اول ابرچین انجام می‌شود. تحویل مشخصات و
          اعتبارنامه پس از تأیید دوم ابرچین است. مشتری قبل از تحویل به Secret
          دسترسی ندارد.
        </p>

        <h2>۳. پرچین و همراهی</h2>
        <p>
          سطح پرچین (شروع، استوار، کهکشان) دامنه پشتیبانی را تعیین می‌کند. جزئیات
          هر سطح در صفحه <Link href="/support">سطح همراهی</Link> آمده است. مرز
          تعهد هر سطح نیز همان‌جا روشن است؛ مانیتورینگ ۲۴/۷ یا بکاپ مدیریت‌شده
          فقط وقتی تضمین می‌شود که صریحاً در قرارداد آن سطح ثبت شده باشد.
        </p>

        <h2>۴. تغییرات پس از تحویل</h2>
        <p>
          مشتری می‌تواند درخواست ارتقا یا حذف ثبت کند. اجرا فقط پس از بررسی و
          تأیید ابرچین انجام می‌شود و خودکار نیست.
        </p>

        <h2>۵. در دسترس‌بودن</h2>
        <p>
          وضعیت اجزای اصلی سامانه در <Link href="/status">وضعیت سرویس</Link>{" "}
          گزارش می‌شود. این گزارش جایگزین قرارداد SLA عددی یا تعهد جریمه قطعی
          نیست.
        </p>

        <h2>۶. پشتیبانی</h2>
        <p>
          درخواست پشتیبانی از{" "}
          <Link href="/account/support">حساب کاربری</Link> یا ایمیل{" "}
          <a href="mailto:support@abrchin.ir" dir="ltr">
            support@abrchin.ir
          </a>{" "}
          ثبت می‌شود. اولویت رسیدگی می‌تواند با سطح پرچین سرویس مرتبط باشد.
        </p>

        <h2>۷. شفافیت حقوقی</h2>
        <p>
          این سیاست رفتار محصول را توصیف می‌کند. شناسه ملی و جزئیات ثبت شرکت پس
          از تأیید بنیان‌گذار منتشر می‌شود. شرایط کلی در{" "}
          <Link href="/terms">شرایط استفاده</Link> و بازپرداخت در{" "}
          <Link href="/refund-policy">سیاست بازپرداخت</Link> است.
        </p>
      </div>
    </section>
  );
}
