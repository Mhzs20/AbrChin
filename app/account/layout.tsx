import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import "../product.css";
import { AccountShell } from "@/components/product/account-shell";
import { ToastProvider } from "@/components/product/toast";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "/account";

  return (
    <ToastProvider>
      <AccountShell user={user} pathname={pathname} walletBalanceRial={wallet?.availableBalance?.toString()}>
        {children}
      </AccountShell>
    </ToastProvider>
  );
}
