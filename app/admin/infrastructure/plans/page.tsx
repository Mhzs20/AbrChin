import type { Metadata } from "next";

import { DataTable, PageHeader, StatusBadge, TechnicalValue } from "@/components/product";
import { listAllPlans } from "@/lib/orders/plans";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { MoneyDisplay } from "@/components/product";

export const metadata: Metadata = {
  title: "پلن‌های زیرساخت | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const plans = await listAllPlans();
  const columns = [
    { key: "code", header: "کد" },
    { key: "title", header: "عنوان" },
    { key: "provider", header: "Provider" },
    { key: "region", header: "Region" },
    { key: "size", header: "Size" },
    { key: "mode", header: "نوع" },
    { key: "price", header: "قیمت فروش" },
    { key: "active", header: "وضعیت" },
  ];

  const rows = plans.map((plan) => ({
    id: plan.id,
    cells: {
      code: <TechnicalValue>{plan.code}</TechnicalValue>,
      title: plan.title,
      provider: plan.provider,
      region: <TechnicalValue>{plan.regionCode}</TechnicalValue>,
      size: <TechnicalValue>{plan.sizeCode}</TechnicalValue>,
      mode: deliveryModeLabel[plan.deliveryMode],
      price: <MoneyDisplay amount={formatTomanFa(plan.salePriceRial)} />,
      active: <StatusBadge label={plan.active ? "فعال" : "غیرفعال"} tone={plan.active ? "success" : "neutral"} />,
    },
  }));

  return (
    <>
      <PageHeader title="پلن‌های زیرساخت" description="مدیریت پلن‌های فروش و مشخصات Provider" />
      <DataTable columns={columns} rows={rows} emptyMessage="پلنی تعریف نشده است." />
    </>
  );
}
