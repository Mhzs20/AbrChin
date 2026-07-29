import type { Metadata } from "next";

import { AdminPlansPanel } from "@/components/admin/plans-panel";
import { DataTable, MoneyDisplay, PageHeader, StatusBadge, TechnicalValue } from "@/components/product";
import { guardAdminPage } from "@/lib/admin/auth";
import { listAllPlans } from "@/lib/orders/plans";
import { deliveryModeLabel } from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";
import { prisma } from "@/lib/db";
import {
  catalogItemBasePriceRial,
  compatibleImageCodes,
} from "@/lib/pricing/plan-pricing";
import { calculateFinalPriceRial } from "@/lib/pricing/provider-pricing";

export const metadata: Metadata = {
  title: "پلن‌های زیرساخت | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  await guardAdminPage();
  const [plans, catalogItems, pricingConfig] = await Promise.all([
    listAllPlans(),
    prisma.providerCatalogItem.findMany({
      where: { provider: "PARSPACK", active: true },
      orderBy: [{ regionCode: "asc" }, { sizeCode: "asc" }],
    }),
    prisma.providerPricingConfig.findUnique({ where: { provider: "PARSPACK" } }),
  ]);
  const panelPlans = plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    title: plan.title,
    description: plan.description,
    deliveryMode: plan.deliveryMode,
    catalogItemId: plan.catalogItemId,
    catalogMappingStatus: plan.catalogMappingStatus,
    imageCode: plan.imageCode,
    deliveryEstimateMinutes: plan.deliveryEstimateMinutes,
    parchinIncluded: plan.parchinIncluded,
    active: plan.active,
    sortOrder: plan.sortOrder,
  }));
  const panelCatalogItems = catalogItems.map((item) => {
    const basePriceRial = catalogItemBasePriceRial(item);
    const finalPriceRial =
      basePriceRial != null && pricingConfig
        ? calculateFinalPriceRial(
            basePriceRial,
            pricingConfig.markupBasisPoints,
          )
        : null;
    return {
      id: item.id,
      regionCode: item.regionCode,
      sizeCode: item.sizeCode,
      compatibleImageCodes: compatibleImageCodes(item),
      vcpu: item.vcpu,
      ramMb: item.ramMb,
      diskGb: item.diskGb,
      available: item.available,
      basePriceRial: basePriceRial?.toString() ?? null,
      finalPriceRial: finalPriceRial?.toString() ?? null,
    };
  });

  const columns = [
    { key: "code", header: "کد" },
    { key: "title", header: "عنوان" },
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
      region: <TechnicalValue>{plan.regionCode}</TechnicalValue>,
      size: <TechnicalValue>{plan.sizeCode}</TechnicalValue>,
      mode: deliveryModeLabel[plan.deliveryMode],
      price: plan.pricing ? (
        <MoneyDisplay amount={formatTomanFa(plan.pricing.finalPriceRial)} />
      ) : (
        "قیمت نامعتبر"
      ),
      active: (
        <StatusBadge
          label={
            plan.catalogMappingStatus !== "MAPPED"
              ? "بدون Mapping"
              : plan.active
                ? "فعال"
                : "غیرفعال"
          }
          tone={plan.active && plan.pricing ? "success" : "neutral"}
        />
      ),
    },
  }));

  return (
    <>
      <PageHeader title="پلن‌های زیرساخت" description="مشخصات محصول روی Catalog Item واقعی؛ منابع و قیمت فقط خواندنی‌اند" />
      <AdminPlansPanel initialPlans={panelPlans} catalogItems={panelCatalogItems} />
      <DataTable columns={columns} rows={rows} emptyMessage="پلنی تعریف نشده است." />
    </>
  );
}
