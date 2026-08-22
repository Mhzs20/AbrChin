import { headers } from "next/headers";
import type { ReactNode } from "react";

import { CustomerShell } from "@/components/product/customer-shell";
import { ToastProvider } from "@/components/product/toast";
import { requireCustomerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const user = await requireCustomerPage();

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "/account";

  return (
    <ToastProvider>
      <CustomerShell user={user} pathname={pathname} walletBalanceRial={wallet?.availableBalance?.toString()}>
        {children}
      </CustomerShell>
    </ToastProvider>
  );
}
