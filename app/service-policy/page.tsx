import { HeartHandshake } from "lucide-react";
import Link from "next/link";

import { LegalDocument, legalMetadata } from "@/components/legal-document";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/legal/config";

export const metadata = legalMetadata({
  title: "سیاست خدمات | ابرچین",
  description:
    "دامنه خدمات ابرچین، پرچین، تحویل کنترل‌شده و محدودیت‌های پشتیبانی.",
  canonical: "/service-policy",
});

export default function ServicePolicyPage() {
  return (
    <LegalDocument
      current="/service-policy"
      eyebrow="سیاست خدمات"
      icon={<HeartHandshake size={15} aria-hidden="true" />}
      titleId="service-policy-title"
      title="سیاست خدمات ابرچین"
    >
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
        سطح پرچین دامنه پشتیبانی را تعیین می‌کند. جزئیات هر سطح در صفحه{" "}
        <Link href="/support">سطح همراهی</Link> فقط وقتی به‌عنوان تعهد فروش
        نمایش داده می‌شود که قرارداد تأییدشده و شواهد عملیاتی موجود باشد. درج
        یک عبارت در تنظیمات یا قیمت صفر به‌تنهایی تضمین خدمت نیست. ادعاهایی مثل
        پاسخ ۲۴/۷، پایش پنج‌دقیقه‌ای، بکاپ روزانه مدیریت‌شده و آزمون Restore
        ماهانه بدون آن شواهد منتشر نمی‌شوند.
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
        <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} dir="ltr">
          {PUBLIC_CONTACT_EMAIL}
        </a>{" "}
        ثبت می‌شود. زمان پاسخ عمومی تا وقتی مالک SLA را رسماً اعلام نکرده منتشر
        نمی‌شود.
      </p>
    </LegalDocument>
  );
}
