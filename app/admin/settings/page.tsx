import type { Metadata } from "next";
import Link from "next/link";

import {
  PageHeader,
  SectionCard,
  StatusBadge,
  type BadgeTone,
} from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { getEnv } from "@/lib/env";
import { isCloudProviderConfigured } from "@/lib/infrastructure/provider-factory";

export const metadata: Metadata = {
  title: "تنظیمات | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const quickLinks = [
  {
    href: "/admin/infrastructure/orders",
    title: "سفارش‌ها و تحویل",
    description: "تأیید ساخت، ثبت مشخصات، تأیید تحویل",
  },
  {
    href: "/admin/infrastructure/plans",
    title: "SKUهای قابل‌فروش",
    description: "انتخاب از کاتالوگ آروان و انتشار",
  },
  {
    href: "/admin/infrastructure/providers",
    title: "منابع Arvan",
    description: "اتصال، Sync و کاتالوگ خام",
  },
  {
    href: "/admin/finance",
    title: "مرکز مالی",
    description: "شیوه محاسبه قیمت، Markup، پرچین، VAT، قطب‌نما، کوپن",
  },
  {
    href: "/admin/infrastructure/regions",
    title: "مناطق فروش",
    description: "Sync و فروش Regionهای AV",
  },
  {
    href: "/admin/connections",
    title: "اتصال سرویس‌ها",
    description: "OTP، درگاه، Provider — فقط وضعیت ماسک‌شده",
  },
  {
    href: "/admin/payment-gateways",
    title: "درگاه‌های پرداخت",
    description: "انتخاب درگاه فعال برای شارژ Wallet",
  },
  {
    href: "/admin/payment-recovery",
    title: "بازیابی پرداخت",
    description: "Callback/Verify و Credit ناقص",
  },
  {
    href: "/admin/wallets",
    title: "کیف پول‌ها",
    description: "موجودی و بررسی مشتری",
  },
  {
    href: "/admin/instances",
    title: "سرورهای تحویل‌شده",
    description: "بازبینی Credential و وضعیت Resource",
  },
  {
    href: "/admin/users",
    title: "کاربران",
    description: "حساب‌های مشتری و نقش‌ها",
  },
  {
    href: "/admin/audit",
    title: "گزارش عملیات",
    description: "Audit اقدامات Admin",
  },
];

export default async function AdminSettingsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

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
      label: "آروان",
      status: isCloudProviderConfigured("ARVAN") ? "فعال" : "تنظیم نشده",
      tone: isCloudProviderConfigured("ARVAN") ? "success" : "warning",
    },
    {
      label: "فروش آروان Cloud",
      status: env.arvanCloudPublicSaleEnabled ? "باز" : "بسته",
      tone: env.arvanCloudPublicSaleEnabled ? "success" : "warning",
    },
    {
      label: "Mutation آروان",
      status: env.arvanMutationsEnabled ? "فعال" : "خاموش (Fulfillment دستی)",
      tone: env.arvanMutationsEnabled ? "warning" : "info",
    },
  ];

  return (
    <>
      <PageHeader
        title="راهنمای پنل و وضعیت پیکربندی"
        description="از اینجا به همه بخش‌های Admin برس. Secretها فقط در Environment سرور هستند."
        actions={
          <Link href="/admin" className="product-btn product-btn--primary">
            بازگشت به مرکز عملیات
          </Link>
        }
      />

      <SectionCard title="دسترسی سریع">
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: 10,
          }}
        >
          {quickLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                style={{
                  display: "block",
                  padding: 14,
                  textDecoration: "none",
                  color: "inherit",
                  border: "1px solid var(--product-line)",
                  borderRadius: "var(--product-radius-sm)",
                  background: "var(--product-surface)",
                }}
              >
                <strong>{link.title}</strong>
                <p
                  style={{
                    margin: "4px 0 0",
                    color: "var(--product-muted)",
                    fontSize: 13,
                  }}
                >
                  {link.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="وضعیت سرویس‌ها (غیرحساس)">
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "grid",
            gap: 12,
          }}
        >
          {items.map((item) => (
            <li
              key={item.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>{item.label}</span>
              <StatusBadge label={item.status} tone={item.tone} />
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 16, color: "var(--product-muted)", fontSize: 13 }}>
          هیچ Secret در این صفحه نمایش یا ذخیره نمی‌شود. برای تغییر Gateها فایل
          `.env` سرور را ویرایش و Web/Worker را Recreate کنید.
        </p>
      </SectionCard>
    </>
  );
}
