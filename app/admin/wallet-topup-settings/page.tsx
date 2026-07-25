import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminTopUpSettingsPanel } from "@/components/admin-topup-settings-panel";
import { getTopUpSettingsView } from "@/lib/wallet/topup-settings";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "تنظیمات شارژ کیف پول | ابرچین",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AdminTopUpSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin/wallet-topup-settings");
  if (user.role !== "ADMIN") redirect("/account");

  const settings = await getTopUpSettingsView();

  return (
    <section className="account-page page-view">
      <div className="page-heading">
        <h1>تنظیمات شارژ کیف پول</h1>
        <p>مبالغ پیشنهادی دکمه‌های صفحه شارژ را تعریف کنید.</p>
      </div>
      <AdminTopUpSettingsPanel initialSettings={settings} />
    </section>
  );
}
