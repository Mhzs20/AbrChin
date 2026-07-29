import type { Metadata } from "next";

import { ProviderPanel } from "@/components/admin/provider-panel";
import {
  getProviderCatalogAdminView,
  getSystemStatuses,
} from "@/lib/admin/dashboard";

export const metadata: Metadata = {
  title: "تأمین‌کننده‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminProvidersPage() {
  const [system, catalogItems] = await Promise.all([
    getSystemStatuses(),
    getProviderCatalogAdminView(),
  ]);
  return (
    <ProviderPanel
      initial={{
        ...system.parspack,
        status: system.parspack.status,
        configured: system.parspack.status !== "unconfigured",
      }}
      catalogItems={catalogItems}
    />
  );
}
