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
          پس از پرداخت، سرور در پنل شما با وضعیت «در حال ساخت» ثبت می‌شود.
          به‌محض تکمیل ساخت توسط تیم ابرچین، وضعیت به فعال تغییر می‌کند و
          مشخصات قابل مشاهده می‌شود.
        </p>
        <p><strong>شارژ کیف پول چگونه انجام می‌شود؟</strong></p>
        <p>
          از بخش کیف پول با درگاه فعال شارژ می‌کنید. برای خرید یا تمدید سرور
          حداقل شارژ یک‌ماهه لازم است؛ دوره‌های بلندتر می‌توانند تخفیف داشته
          باشند.
        </p>
        <p><strong>آیا می‌توانم سرور را ارتقا یا حذف کنم؟</strong></p>
        <p>
          بله — از پنل سرویس می‌توانید درخواست ارتقا یا حذف ثبت کنید. اجرا فقط
          پس از بررسی و تأیید تیم ابرچین انجام می‌شود.
        </p>
      </SectionCard>
    </>
  );
}
