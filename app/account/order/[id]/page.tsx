import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader, SectionCard, StatusBadge } from "@/components/product";
import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { getActivePlanById } from "@/lib/orders/plans";
import { parchinPlanLabel, parchinPlanSummary } from "@/lib/parchin/catalog";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "تکمیل سفارش | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/account/order/${id}`)}`);

  const plan = await getActivePlanById(id);
  if (!plan) redirect("/account/order");

  return (
    <>
      <PageHeader
        title={plan.title}
        description="جزئیات فنی و پرداخت با کیف پول"
        actions={
          <Link href="/account/order" className="product-btn product-btn--quiet">
            بازگشت
          </Link>
        }
      />
      <SectionCard title="خلاصه راهکار">
        <p style={{ marginTop: 0 }}>{plan.description}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <StatusBadge label={deliveryModeLabel[plan.deliveryMode]} tone="info" />
          {plan.vcpu ? <span className="product-tech">{plan.vcpu} vCPU</span> : null}
          {plan.ramGb ? <span className="product-tech">{plan.ramGb} GB RAM</span> : null}
          {plan.storageGb ? <span className="product-tech">{plan.storageGb} GB فضا</span> : null}
          <span className="product-tech">ماه اول {formatTomanFa(plan.salePriceRial)} تومان</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--product-muted)" }}>
          تمدید ماهانه:{" "}
          <strong>{formatTomanFa(plan.renewalPriceRial ?? plan.salePriceRial)} تومان</strong>
          {" · "}تحویل حدود {plan.deliveryEstimateMinutes.toLocaleString("fa-IR")} دقیقه
          {" · "}{parchinPlanLabel(plan.parchinIncluded)}
        </div>
        <p style={{ fontSize: 13, color: "var(--product-muted)", marginBottom: 0 }}>
          {parchinPlanSummary(plan.parchinIncluded)}
        </p>
      </SectionCard>
      <OrderCheckoutPanel planId={plan.id} planTitle={plan.title} priceToman={formatTomanFa(plan.salePriceRial)} />
    </>
  );
}
