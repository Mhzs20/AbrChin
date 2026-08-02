import type { Metadata } from "next";

import { DataTable, MoneyDisplay, PageHeader } from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { ledgerDirectionLabel, ledgerTypeLabel } from "@/lib/labels/ledger";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "تراکنش‌ها | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminTransactionsPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const entries = await prisma.walletLedgerEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { wallet: { include: { user: true } } },
  });

  const columns = [
    { key: "user", header: "کاربر" },
    { key: "type", header: "نوع" },
    { key: "direction", header: "جهت" },
    { key: "amount", header: "مبلغ" },
    { key: "balance", header: "مانده" },
    { key: "status", header: "وضعیت" },
    { key: "createdAt", header: "زمان" },
  ];

  const rows = entries.map((entry) => ({
    id: entry.id,
    cells: {
      user: <span className="product-tech">{entry.wallet.user.mobile}</span>,
      type: ledgerTypeLabel[entry.type],
      direction: ledgerDirectionLabel[entry.direction],
      amount: <MoneyDisplay amount={formatTomanFa(entry.amount)} />,
      balance: <MoneyDisplay amount={formatTomanFa(entry.balanceAfter)} />,
      status: entry.status,
      createdAt: new Date(entry.createdAt).toLocaleString("fa-IR"),
    },
  }));

  return (
    <>
      <PageHeader title="تراکنش‌ها" description="تمام سندهای Ledger" />
      <DataTable columns={columns} rows={rows} />
    </>
  );
}
