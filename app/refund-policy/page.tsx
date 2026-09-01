import { Receipt } from "lucide-react";
import Link from "next/link";

import { LegalDocument, legalMetadata } from "@/components/legal-document";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/legal/config";
import { REFUND_SCENARIOS } from "@/lib/legal/refund-behavior";

export const metadata = legalMetadata({
  title: "سیاست بازپرداخت | ابرچین",
  description:
    "قواعد بازپرداخت سفارش و شارژ کیف پول در ابرچین؛ بدون وعده بازپرداخت خودکار نقدی.",
  canonical: "/refund-policy",
});

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      current="/refund-policy"
      eyebrow="بازپرداخت"
      icon={<Receipt size={15} aria-hidden="true" />}
      titleId="refund-title"
      title="سیاست بازپرداخت"
    >
      <h2>اصل کلی</h2>
      <p>
        خرید سرور دوره‌ای پیش‌پرداخت است. پرداخت موفق سفارش را ثبت می‌کند اما
        ساخت و تحویل فقط پس از تأییدهای ابرچین انجام می‌شود. بازپرداخت سفارش یک
        اقدام کنترل‌شده ادمین یا مسیر لغو دوره‌ای پس از خاتمه قطعی سرور است، نه
        نتیجه خودکار هر اختلاف. مقصد بازگشت سفارش کیف پول داخلی ابرچین است؛
        بازگشت نقدی/کارت/شبا خودکار وعده داده نمی‌شود.
      </p>

      {REFUND_SCENARIOS.map((scenario) => (
        <section key={scenario.id}>
          <h2>{scenario.title}</h2>
          <p>{scenario.behavior}</p>
        </section>
      ))}

      <h2>پیوندها</h2>
      <p>
        درخواست بررسی را از{" "}
        <Link href="/account/support">پشتیبانی حساب</Link> یا{" "}
        <a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} dir="ltr">
          {PUBLIC_CONTACT_EMAIL}
        </a>{" "}
        ثبت کنید. همچنین ببینید: <Link href="/terms">شرایط استفاده</Link> و{" "}
        <Link href="/privacy">حریم خصوصی</Link>.
      </p>
    </LegalDocument>
  );
}
