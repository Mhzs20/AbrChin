import type { Metadata } from "next";

import { AdminTopUpSettingsPanel } from "@/components/admin-topup-settings-panel";
import { PageHeader } from "@/components/product";
import { getTopUpSettingsView } from "@/lib/wallet/topup-settings";

export const metadata: Metadata = {
  title: "تنظیمات شارژ کیف پول | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminTopUpSettingsPage() {
  const settings = await getTopUpSettingsView();
  return (
    <>
      <PageHeader title="تنظیمات شارژ کیف پول" description="مبالغ پیشنهادی و پیش‌نمایش نمایش کاربر" />
      <AdminTopUpSettingsPanel initialSettings={settings} />
    </>
  );
}
