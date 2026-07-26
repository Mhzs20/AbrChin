import type { Metadata } from "next";

import { PageHeader, SectionCard, StatusBadge, type BadgeTone } from "@/components/product";
import { getEnv } from "@/lib/env";
import { isProviderConfigured } from "@/lib/infrastructure/provider-factory";

export const metadata: Metadata = {
  title: "تنظیمات | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  const env = getEnv();

  const items: { label: string; status: string; tone: BadgeTone }[] = [
    {
      label: "پایگاه داده",
      status: env.databaseUrl ? "پیکربندی شده" : "تنظیم نشده",
      tone: env.databaseUrl ? "success" : "danger",
    },
    {
      label: "Session",
      status: env.sessionSecret.length >= 16 ? "پیکربندی شده" : "تنظیم نشده",
      tone: env.sessionSecret.length >= 16 ? "success" : "danger",
    },
    {
      label: "Kavenegar",
      status: env.kavenegarApiKey ? "فعال" : "تنظیم نشده",
      tone: env.kavenegarApiKey ? "success" : "warning",
    },
    {
      label: "Zibal",
      status: env.zibalMerchant ? "پیکربندی شده" : "تنظیم نشده",
      tone: env.zibalMerchant ? "success" : "warning",
    },
    {
      label: "ZarinPal",
      status: env.zarinpalMerchantId ? "پیکربندی شده" : "تنظیم نشده",
      tone: env.zarinpalMerchantId ? "success" : "warning",
    },
    {
      label: "ParsPack",
      status: isProviderConfigured() ? "فعال" : "تنظیم نشده",
      tone: isProviderConfigured() ? "success" : "warning",
    },
    {
      label: "Infrastructure Mode",
      status: env.infrastructureProviderMode,
      tone: env.isProduction && env.infrastructureProviderMode === "mock" ? "danger" : "info",
    },
  ];

  return (
    <>
      <PageHeader
        title="تنظیمات"
        description="وضعیت پیکربندی غیرحساس — Secretها فقط از Environment Variables مدیریت می‌شوند."
      />
      <SectionCard title="وضعیت سرویس‌ها">
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
          {items.map((item) => (
            <li key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{item.label}</span>
              <StatusBadge label={item.status} tone={item.tone} />
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 16, color: "var(--product-muted)", fontSize: 13 }}>
          هیچ Secret در این صفحه نمایش یا ذخیره نمی‌شود.
        </p>
      </SectionCard>
    </>
  );
}
