import { HeartHandshake } from "lucide-react";
import type { Metadata } from "next";

import { SupportSelector } from "@/components/support-selector";
import { loadPublicParchinCatalog } from "@/lib/parchin/availability";

export const metadata: Metadata = {
  title: "پرچین و سطح همراهی | ابرچین",
  description:
    "وضعیت واقعی سطوح پرچین ابرچین؛ تعهد عملیاتی فقط با قرارداد تأییدشده و شواهد.",
  alternates: { canonical: "/support" },
};

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const catalog = await loadPublicParchinCatalog();

  return (
    <section className="support-page page-view" aria-labelledby="support-title">
      <header className="page-heading centered-heading">
        <div className="eyebrow">
          <HeartHandshake size={15} aria-hidden="true" /> عملیات و نگهداری سرور
        </div>
        <h1 id="support-title">پرچین یعنی سرورت بعد از تحویل تنها نمی‌ماند.</h1>
        <p>
          سطح همراهی فقط وقتی برای خرید نمایش داده می‌شود که قرارداد تأییدشده و
          شواهد عملیاتی موجود باشد. قطع پایگاه‌داده یا نبود شواهد به‌معنی فعال
          بودن با قیمت صفر نیست.
        </p>
      </header>
      {catalog.status !== "available" ? (
        <div className="support-unavailable" role="status">
          {catalog.reason === "database_failure"
            ? "وضعیت قراردادهای پرچین الان مشخص نیست؛ پایگاه‌داده در دسترس نبود. هیچ سطح همراهی فعال فرض نشده است."
            : "سطوح پرچین برای فروش عمومی در انتظار تأیید قرارداد و شواهد عملیاتی هستند. خرید سطح تأییدنشده ممکن نیست."}
        </div>
      ) : null}
      <SupportSelector catalog={catalog} />
    </section>
  );
}
