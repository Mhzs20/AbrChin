import { headers } from "next/headers";
import type { ReactNode } from "react";

import "../product.css";
import { AdminShell } from "@/components/product/admin-shell";
import { ToastProvider } from "@/components/product/toast";
import { guardAdminPage } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { AdminNotificationStatus } from "@prisma/client";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await guardAdminPage();
  const unreadNotifications = await prisma.adminNotification.count({
    where: { status: AdminNotificationStatus.UNREAD },
  });
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "/admin";

  return (
    <ToastProvider>
      <AdminShell user={user} pathname={pathname} unreadNotifications={unreadNotifications}>
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
