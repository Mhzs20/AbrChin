import {
  LedgerDirection,
  LedgerStatus,
  LedgerType,
  TopUpStatus,
} from "@prisma/client";

import { computeWalletRechargeTotals } from "@/lib/admin/wallet-recharge-totals";
import { prisma } from "@/lib/db";

export { computeWalletRechargeTotals } from "@/lib/admin/wallet-recharge-totals";

export async function getAdminWalletsOverview(input?: { take?: number }) {
  const take = Math.min(Math.max(input?.take ?? 200, 1), 500);

  const [
    users,
    balanceAggregate,
    topUpCreditAggregate,
    topUpRefundAggregate,
    succeededTopUpAggregate,
    customerCount,
    walletCount,
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: [
        { wallet: { availableBalance: "desc" } },
        { createdAt: "desc" },
      ],
      take,
      select: {
        id: true,
        mobile: true,
        displayName: true,
        role: true,
        createdAt: true,
        wallet: {
          select: {
            id: true,
            availableBalance: true,
            status: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.wallet.aggregate({
      _sum: { availableBalance: true },
      _count: { _all: true },
    }),
    prisma.walletLedgerEntry.aggregate({
      where: {
        type: LedgerType.TOP_UP,
        direction: LedgerDirection.CREDIT,
        status: LedgerStatus.COMPLETED,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.walletLedgerEntry.aggregate({
      where: {
        type: LedgerType.TOP_UP_REFUND,
        direction: LedgerDirection.DEBIT,
        status: LedgerStatus.COMPLETED,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.walletTopUp.aggregate({
      where: { status: TopUpStatus.SUCCEEDED },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.wallet.count(),
  ]);

  const recharge = computeWalletRechargeTotals({
    topUpCreditRial: topUpCreditAggregate._sum.amount ?? 0n,
    topUpRefundRial: topUpRefundAggregate._sum.amount ?? 0n,
  });

  return {
    listedCount: users.length,
    customerCount,
    walletCount,
    totalAvailableBalanceRial: balanceAggregate._sum.availableBalance ?? 0n,
    topUpCreditCount: topUpCreditAggregate._count._all,
    topUpRefundCount: topUpRefundAggregate._count._all,
    succeededGatewayTopUpCount: succeededTopUpAggregate._count._all,
    succeededGatewayTopUpRial: succeededTopUpAggregate._sum.amount ?? 0n,
    ...recharge,
    users: users.map((user) => ({
      id: user.id,
      mobile: user.mobile,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      wallet: user.wallet
        ? {
            id: user.wallet.id,
            availableBalanceRial: user.wallet.availableBalance,
            status: user.wallet.status,
            updatedAt: user.wallet.updatedAt,
          }
        : null,
    })),
  };
}
