import type { Metadata } from "next";

import { ServiceConnectionsPanel } from "@/components/admin/service-connections-panel";
import { PageHeader } from "@/components/product";
import { getServiceConnectionsAdminView } from "@/lib/admin/service-connections";
import { getAdminPageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "اتصال سرویس‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminConnectionsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;
  const connections = await getServiceConnectionsAdminView();
  return (
    <>
      <PageHeader
        title="اتصال سرویس‌ها"
        description="فقط وضعیت ماسک‌شده و نتیجه بررسی امن نمایش داده می‌شود؛ Secretها هرگز در پنل ذخیره یا نمایش داده نمی‌شوند."
      />
      <ServiceConnectionsPanel initialConnections={connections} />
    </>
  );
}
