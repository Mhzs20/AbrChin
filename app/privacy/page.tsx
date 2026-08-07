import { Shield } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LegalPageNav } from "@/components/legal-page-nav";

export const metadata: Metadata = {
  title: "حریم خصوصی | ابرچین",
  description:
    "نحوه نگهداری و استفاده از داده‌های حساب، سفارش و پشتیبانی در ابرچین.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <section className="legal-page page-view" aria-labelledby="privacy-title">
      <header className="page-heading">
        <div className="eyebrow">
          <Shield size={15} aria-hidden="true" /> حریم خصوصی
        </div>
        <h1 id="privacy-title">حریم خصوصی در ابرچین</h1>
        <p>
          این سیاست رفتار فعلی محصول درباره داده‌های مشتری را شرح می‌دهد. جزئیات
          حقوقی ثبت شرکت پس از تأیید بنیان‌گذار اعلام می‌شود و در اینجا جعل
          نشده است.
        </p>
      </header>

      <LegalPageNav current="/privacy" />

      <div className="legal-prose">
        <h2>۱. داده‌هایی که جمع می‌شود</h2>
        <p>
          برای ارائه خدمت، ابرچین ممکن است شماره موبایل، نام نمایشی، سوابق سفارش،
          تراکنش کیف پول، مشخصات پیکربندی سرور، پیام‌های پشتیبانی و لاگ‌های امنیتی
          ضروری را نگه دارد.
        </p>

        <h2>۲. هدف استفاده</h2>
        <p>
          داده‌ها برای احراز هویت، پردازش پرداخت و سفارش، دو مرحله تأیید ابرچین
          (ساخت و تحویل)، پشتیبانی قراردادی پرچین، حسابداری و جلوگیری از سوءاستفاده
          استفاده می‌شوند.
        </p>

        <h2>۳. اعتبارنامه و اسرار</h2>
        <p>
          تا قبل از تأیید تحویل ابرچین، مشتری به اعتبارنامه دسترسی ندارد. پس از
          تحویل، نمایش Secret محدود و کنترل‌شده است. Secret در لاگ عمومی، پیام خطا
          یا اعلان‌های عمومی قرار نمی‌گیرد.
        </p>

        <h2>۴. اشتراک‌گذاری</h2>
        <p>
          برای تکمیل پرداخت یا تأمین زیرساخت، دادهٔ حداقلی لازم ممکن است با
          درگاه بانکی یا تأمین‌کننده پشت‌صحنه تبادل شود. ابرچین داده را برای
          فروش تبلیغاتی به اشخاص ثالث نمی‌فروشد.
        </p>

        <h2>۵. نگهداری و امنیت</h2>
        <p>
          دسترسی مدیریتی محدود است و اقدامات حساس با ثبت عملیات همراه می‌شود.
          مشتری مسئول حفظ دسترسی به موبایل و اطلاعات پس از تحویل است.
        </p>

        <h2>۶. ارتباط و حقوق</h2>
        <p>
          برای پرسش درباره داده یا حذف حساب، از{" "}
          <Link href="/account/support">پشتیبانی حساب</Link> یا ایمیل{" "}
          <a href="mailto:support@abrchin.ir" dir="ltr">
            support@abrchin.ir
          </a>{" "}
          استفاده کنید. شرایط خدمت در{" "}
          <Link href="/terms">شرایط استفاده</Link> آمده است.
        </p>
      </div>
    </section>
  );
}
