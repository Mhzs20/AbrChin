import {
  MessageGoCustomerConnectionStatus,
  MessageGoReservationStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { isMessageGoConfigured } from "@/lib/messagego/config";
import {
  getProviderSecretHandoffPort,
  HandoffError,
  isStableFamilyAlias,
  type OwnershipMode,
} from "@/lib/messagego/customer/handoff";
import {
  toCustomerConnectionView,
  type CustomerConnectionView,
} from "@/lib/messagego/customer/view";
import { formatTomanFa } from "@/lib/money";
import { walletAmountString } from "@/lib/messagego/settlement/amount";

export type { CustomerConnectionView } from "@/lib/messagego/customer/view";
export {
  customerViewContainsForbiddenSecret,
  toCustomerConnectionView,
} from "@/lib/messagego/customer/view";

const CONNECTION_SELECT = {
  id: true,
  userId: true,
  productId: true,
  workspaceId: true,
  alias: true,
  ownershipMode: true,
  familyAlias: true,
  status: true,
  lastHandoffAt: true,
  lastErrorCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CustomerReservationView = {
  authority_reservation_id: string;
  status: MessageGoReservationStatus;
  status_label: string;
  product_id: string;
  workspace_id: string;
  run_id: string;
  hold_amount_rial: string;
  remaining_hold_rial: string;
  settled_amount_rial: string;
  hold_amount_toman_fa: string;
  remaining_hold_toman_fa: string;
  settled_amount_toman_fa: string;
  created_at: string;
};

export type CustomerAiSurface = {
  control_plane: {
    available: boolean;
    configured: boolean;
    fail_closed: boolean;
    execution_owner: "messagego";
    wallet_owner: "abrchin";
    inference_proxy: false;
  };
  wallet: {
    available_balance_rial: string;
    available_balance_toman_fa: string;
    reserved_ai_rial: string;
    reserved_ai_toman_fa: string;
  };
  connections: CustomerConnectionView[];
  reservations: CustomerReservationView[];
};

const statusLabel: Record<MessageGoReservationStatus, string> = {
  RESERVED: "رزرو فعال",
  SETTLED: "تسویه‌شده",
  RELEASED: "آزادشده",
  UNCERTAIN: "نامشخص — در انتظار تطبیق",
  RECONCILED: "تطبیق‌شده",
};

export async function getCustomerAiSurface(userId: string): Promise<CustomerAiSurface> {
  const configured = isMessageGoConfigured();
  const [wallet, connections, reservations] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.messageGoCustomerConnection.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: CONNECTION_SELECT,
    }),
    prisma.messageGoAuthorityReservation.findMany({
      where: { accountId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const reservedAi = reservations
    .filter(
      (row) =>
        row.status === MessageGoReservationStatus.RESERVED ||
        row.status === MessageGoReservationStatus.UNCERTAIN,
    )
    .reduce((sum, row) => sum + row.remainingHoldRial, 0n);
  const available = wallet?.availableBalance ?? 0n;
  return {
    control_plane: {
      available: configured,
      configured,
      fail_closed: !configured,
      execution_owner: "messagego",
      wallet_owner: "abrchin",
      inference_proxy: false,
    },
    wallet: {
      available_balance_rial: walletAmountString(available),
      available_balance_toman_fa: formatTomanFa(available),
      reserved_ai_rial: walletAmountString(reservedAi),
      reserved_ai_toman_fa: formatTomanFa(reservedAi),
    },
    connections: connections.map(toCustomerConnectionView),
    reservations: reservations.map((row) => ({
      authority_reservation_id: row.id,
      status: row.status,
      status_label: statusLabel[row.status],
      product_id: row.productId,
      workspace_id: row.workspaceId,
      run_id: row.runId,
      hold_amount_rial: walletAmountString(row.holdAmountRial),
      remaining_hold_rial: walletAmountString(row.remainingHoldRial),
      settled_amount_rial: walletAmountString(row.settledAmountRial),
      hold_amount_toman_fa: formatTomanFa(row.holdAmountRial),
      remaining_hold_toman_fa: formatTomanFa(row.remainingHoldRial),
      settled_amount_toman_fa: formatTomanFa(row.settledAmountRial),
      created_at: row.createdAt.toISOString(),
    })),
  };
}

export async function handoffCustomerProviderCredential(input: {
  userId: string;
  productId: string;
  workspaceId: string;
  alias: string;
  ownershipMode: string;
  familyAlias: string;
  credential: string;
}) {
  const productId = input.productId.trim();
  const workspaceId = input.workspaceId.trim();
  const alias = input.alias.trim();
  const familyAlias = input.familyAlias.trim();
  if (!productId || !workspaceId || !alias) {
    throw new HandoffError("invalid_request", "شناسه محصول، فضای کاری و نام اتصال لازم است.");
  }
  if (!isStableFamilyAlias(familyAlias)) {
    throw new HandoffError("invalid_family", "خانواده مدل پایدار نامعتبر است.");
  }
  const ownershipMode = input.ownershipMode.trim() as OwnershipMode;
  if (
    ownershipMode !== "ACCOUNT_BYOK" &&
    ownershipMode !== "PROJECT_BYOK" &&
    ownershipMode !== "PLATFORM_MANAGED"
  ) {
    throw new HandoffError("invalid_ownership", "حالت مالکیت اتصال نامعتبر است.");
  }

  if (!isMessageGoConfigured()) {
    const saved = await prisma.messageGoCustomerConnection.upsert({
      where: {
        userId_productId_workspaceId_alias: {
          userId: input.userId,
          productId,
          workspaceId,
          alias,
        },
      },
      update: {
        ownershipMode,
        familyAlias,
        status: MessageGoCustomerConnectionStatus.CONTROL_PLANE_UNAVAILABLE,
        lastErrorCode: "control_plane_unavailable",
        secretRef: null,
      },
      create: {
        userId: input.userId,
        productId,
        workspaceId,
        alias,
        ownershipMode,
        familyAlias,
        status: MessageGoCustomerConnectionStatus.CONTROL_PLANE_UNAVAILABLE,
        lastErrorCode: "control_plane_unavailable",
      },
      select: CONNECTION_SELECT,
    });
    return {
      ok: false as const,
      code: "control_plane_unavailable",
      connection: toCustomerConnectionView(saved),
    };
  }

  if (ownershipMode === "PLATFORM_MANAGED") {
    const saved = await prisma.messageGoCustomerConnection.upsert({
      where: {
        userId_productId_workspaceId_alias: {
          userId: input.userId,
          productId,
          workspaceId,
          alias,
        },
      },
      update: {
        ownershipMode,
        familyAlias,
        status: MessageGoCustomerConnectionStatus.CONNECTED,
        lastErrorCode: null,
        secretRef: null,
        lastHandoffAt: new Date(),
      },
      create: {
        userId: input.userId,
        productId,
        workspaceId,
        alias,
        ownershipMode,
        familyAlias,
        status: MessageGoCustomerConnectionStatus.CONNECTED,
      },
      select: CONNECTION_SELECT,
    });
    return { ok: true as const, connection: toCustomerConnectionView(saved) };
  }

  const port = getProviderSecretHandoffPort();
  try {
    const handed = await port.handoff({
      accountId: input.userId,
      productId,
      workspaceId,
      ownershipMode,
      familyAlias,
      plaintext: input.credential,
    });
    const saved = await prisma.messageGoCustomerConnection.upsert({
      where: {
        userId_productId_workspaceId_alias: {
          userId: input.userId,
          productId,
          workspaceId,
          alias,
        },
      },
      update: {
        ownershipMode,
        familyAlias,
        status: MessageGoCustomerConnectionStatus.CONNECTED,
        secretRef: handed.secretRef,
        lastHandoffAt: new Date(),
        lastErrorCode: null,
      },
      create: {
        userId: input.userId,
        productId,
        workspaceId,
        alias,
        ownershipMode,
        familyAlias,
        status: MessageGoCustomerConnectionStatus.CONNECTED,
        secretRef: handed.secretRef,
        lastHandoffAt: new Date(),
      },
      select: CONNECTION_SELECT,
    });
    return { ok: true as const, connection: toCustomerConnectionView(saved) };
  } catch (error) {
    const code = error instanceof HandoffError ? error.code : "handoff_failed";
    const saved = await prisma.messageGoCustomerConnection.upsert({
      where: {
        userId_productId_workspaceId_alias: {
          userId: input.userId,
          productId,
          workspaceId,
          alias,
        },
      },
      update: {
        ownershipMode,
        familyAlias,
        status:
          code === "handoff_unavailable"
            ? MessageGoCustomerConnectionStatus.CONTROL_PLANE_UNAVAILABLE
            : MessageGoCustomerConnectionStatus.HANDOFF_FAILED,
        lastErrorCode: code,
        secretRef: null,
      },
      create: {
        userId: input.userId,
        productId,
        workspaceId,
        alias,
        ownershipMode,
        familyAlias,
        status:
          code === "handoff_unavailable"
            ? MessageGoCustomerConnectionStatus.CONTROL_PLANE_UNAVAILABLE
            : MessageGoCustomerConnectionStatus.HANDOFF_FAILED,
        lastErrorCode: code,
      },
      select: CONNECTION_SELECT,
    });
    return {
      ok: false as const,
      code,
      connection: toCustomerConnectionView(saved),
    };
  }
}
