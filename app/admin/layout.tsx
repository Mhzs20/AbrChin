import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/product/admin-shell";
import { AdminAccessDenied } from "@/components/product/panel-access-denied";
import { ToastProvider } from "@/components/product/toast";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { AdminNotificationStatus } from "@prisma/client";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return <AdminAccessDenied />;

  const { user } = access;
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
