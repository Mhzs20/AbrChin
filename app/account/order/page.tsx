import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, SectionCard, StatusBadge } from "@/components/product";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { listActivePlans } from "@/lib/orders/plans";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "انتخاب راهکار | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const plans = await listActivePlans();

  return (
    <>
      <PageHeader
        title="سرورهای آماده"
        description="قیمت و منابع را ببین، یک چینش را انتخاب کن و مستقیم پرداخت را انجام بده."
      />
      <div className="product-grid product-grid--2">
        {plans.map((plan) => (
          <SectionCard key={plan.id} title={plan.title}>
            <p style={{ color: "var(--product-muted)", marginTop: 0 }}>{plan.description}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <StatusBadge label={deliveryModeLabel[plan.deliveryMode]} tone="info" />
              {plan.vcpu ? <span className="product-tech">{plan.vcpu} vCPU</span> : null}
              {plan.ramGb ? <span className="product-tech">{plan.ramGb} GB RAM</span> : null}
              {plan.storageGb ? <span className="product-tech">{plan.storageGb} GB</span> : null}
              <span className="product-tech">{formatTomanFa(plan.salePriceRial)} تومان</span>
            </div>
            <Link href={`/account/order/${plan.id}`} className="product-btn product-btn--primary">
              ادامه و پرداخت
            </Link>
          </SectionCard>
        ))}
      </div>
      {plans.length === 0 ? (
        <EmptyState title="پلن فعالی موجود نیست" description="لطفاً بعداً دوباره بررسی کنید." />
      ) : null}
    </>
  );
}
