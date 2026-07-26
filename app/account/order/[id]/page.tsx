import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader, SectionCard, StatusBadge } from "@/components/product";
import { OrderCheckoutPanel } from "@/components/account/order-checkout-panel";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { getActivePlanById } from "@/lib/orders/plans";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "تکمیل سفارش | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AccountOrderPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/order");

  const { id } = await params;
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
          <span className="product-tech">{formatTomanFa(plan.salePriceRial)} تومان</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--product-muted)" }}>
          منطقه: <span className="product-tech">{plan.regionCode}</span> · اندازه:{" "}
          <span className="product-tech">{plan.sizeCode}</span>
        </div>
      </SectionCard>
      <OrderCheckoutPanel planId={plan.id} planTitle={plan.title} priceToman={formatTomanFa(plan.salePriceRial)} />
    </>
  );
}
