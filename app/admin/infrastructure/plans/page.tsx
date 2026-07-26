import type { Metadata } from "next";

import { AdminPlansPanel } from "@/components/admin/plans-panel";
import { DataTable, MoneyDisplay, PageHeader, StatusBadge, TechnicalValue } from "@/components/product";
import { guardAdminPage } from "@/lib/admin/auth";
import { listAllPlans } from "@/lib/orders/plans";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "پلن‌های زیرساخت | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  await guardAdminPage();
  const plans = await listAllPlans();
  const panelPlans = plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    regionCode: plan.regionCode,
    sizeCode: plan.sizeCode,
    imageCode: plan.imageCode,
    salePriceRial: plan.salePriceRial.toString(),
    estimatedProviderCostRial: plan.estimatedProviderCostRial.toString(),
    active: plan.active,
    sortOrder: plan.sortOrder,
  }));

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
      <AdminPlansPanel initialPlans={panelPlans} />
      <DataTable columns={columns} rows={rows} emptyMessage="پلنی تعریف نشده است." />
    </>
  );
}
