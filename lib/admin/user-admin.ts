import {
  CloudInstanceStatus,
  UserAccountStatus,
  UserRole,
  WalletStatus,
  type Prisma,
} from "@prisma/client";

import {
  assertAdminActorTx,
  normalizeAdminCommand,
  persistAdminCommandReceiptTx,
  replayAdminCommandTx,
} from "@/lib/admin/command-receipt";
import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { isAdminMobile } from "@/lib/env";
import { normalizeIranMobile } from "@/lib/mobile";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";
import { WalletError } from "@/lib/wallet/errors";

function asUserError(code: string, message: string) {
  return new WalletError(code, message);
}

export async function listAdminManagedUsers(input?: { take?: number }) {
  const take = Math.min(Math.max(input?.take ?? 200, 1), 500);
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      wallet: true,
      _count: {
        select: {
          orders: true,
          cloudInstances: true,
          infrastructureOrders: true,
        },
      },
    },
  });
}

export async function getAdminManagedUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallet: {
        include: {
          ledgerEntries: { orderBy: { createdAt: "desc" }, take: 30 },
        },
      },
      cloudInstances: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          infrastructureOrder: {
            select: { id: true, status: true, serviceOrderId: true },
          },
          subscription: {
            select: { id: true, status: true, nextRenewalAt: true },
          },
        },
      },
      orders: { orderBy: { createdAt: "desc" }, take: 30 },
      infrastructureOrders: { orderBy: { createdAt: "desc" }, take: 30 },
      sessions: {
        where: { revokedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
      },
      _count: {
        select: {
          orders: true,
          cloudInstances: true,
          sessions: true,
        },
      },
    },
  });
}

export async function listUserSiteActivity(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      wallet: { select: { id: true } },
      cloudInstances: { select: { id: true } },
    },
  });
  if (!user) return null;

  const instanceIds = user.cloudInstances.map((row) => row.id);
  const [actorAudits, entityAudits, ledger, orders, instances] =
    await Promise.all([
      prisma.auditLog.findMany({
        where: { actorUserId: userId },
        orderBy: { createdAt: "desc" },
        take: 80,
        include: { actor: { select: { mobile: true } } },
      }),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { entityType: "user", entityId: userId },
            ...(user.wallet
              ? [{ entityType: "wallet", entityId: user.wallet.id }]
              : []),
            ...(instanceIds.length > 0
              ? [
                  {
                    entityType: "cloud_instance",
                    entityId: { in: instanceIds },
                  },
                ]
              : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        include: { actor: { select: { mobile: true } } },
      }),
      user.wallet
        ? prisma.walletLedgerEntry.findMany({
            where: { walletId: user.wallet.id },
            orderBy: { createdAt: "desc" },
            take: 40,
          })
        : Promise.resolve([]),
      prisma.serviceOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          title: true,
          status: true,
          amount: true,
          createdAt: true,
          paidAt: true,
        },
      }),
      prisma.cloudInstance.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          name: true,
          status: true,
          providerInstanceId: true,
          createdAt: true,
          deliveredAt: true,
          terminatedAt: true,
        },
      }),
    ]);

  type ActivityItem = {
    id: string;
    at: string;
    kind: string;
    title: string;
    detail: string;
  };

  const items: ActivityItem[] = [];

  for (const row of [...actorAudits, ...entityAudits]) {
    items.push({
      id: `audit:${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "audit",
      title: row.action,
      detail: `${row.entityType}${row.entityId ? ` · ${row.entityId}` : ""} · actor ${row.actor.mobile}`,
    });
  }
  for (const row of ledger) {
    items.push({
      id: `ledger:${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "ledger",
      title: `${row.type} · ${row.direction}`,
      detail: row.description ?? row.status,
    });
  }
  for (const row of orders) {
    items.push({
      id: `order:${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "order",
      title: row.title,
      detail: `${row.status}${row.paidAt ? " · پرداخت‌شده" : ""}`,
    });
  }
  for (const row of instances) {
    items.push({
      id: `instance:${row.id}`,
      at: row.createdAt.toISOString(),
      kind: "server",
      title: row.name,
      detail: `${row.status} · ${row.providerInstanceId}`,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  // Deduplicate audit rows that matched both actor and entity queries.
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export async function adminCreateUser(input: {
  actorUserId: string;
  mobile: string;
  displayName?: string | null;
  role?: UserRole;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const normalized = normalizeIranMobile(input.mobile);
  if (!normalized.ok) throw asUserError("invalid_mobile", normalized.error);

  const role =
    input.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.CUSTOMER;
  if (role === UserRole.ADMIN && !isAdminMobile(normalized.mobile)) {
    throw asUserError(
      "admin_mobile_required",
      "نقش مدیر فقط برای موبایل‌های ADMIN_MOBILES مجاز است.",
    );
  }

  const command = normalizeAdminCommand({
    operation: "user_create",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      mobile: normalized.mobile,
      displayName: input.displayName ?? null,
      role,
    },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as { userId: string; mobile: string };

    const existing = await tx.user.findUnique({
      where: { mobile: normalized.mobile },
    });
    if (existing) {
      throw asUserError("user_exists", "کاربر با این موبایل از قبل وجود دارد.");
    }

    const displayName =
      typeof input.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim().slice(0, 120)
        : null;

    const user = await tx.user.create({
      data: {
        mobile: normalized.mobile,
        displayName,
        role,
        accountStatus: UserAccountStatus.ACTIVE,
        mobileVerifiedAt: null,
      },
    });
    await ensureWalletForUser(user.id, tx);

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.USER_CREATE,
        entityType: "user",
        entityId: user.id,
        afterData: {
          mobile: user.mobile,
          displayName: user.displayName,
          role: user.role,
          reason: command.reason,
        },
        idempotencyKey: command.receiptKey,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    const result = { userId: user.id, mobile: user.mobile };
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}

export async function adminUpdateUser(input: {
  actorUserId: string;
  userId: string;
  displayName?: string | null;
  role?: UserRole;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "user_update",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      userId: input.userId,
      displayName: input.displayName ?? null,
      role: input.role ?? null,
    },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as { userId: string };

    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before) throw asUserError("user_not_found", "کاربر پیدا نشد.");

    let nextRole = before.role;
    if (input.role === UserRole.ADMIN || input.role === UserRole.CUSTOMER) {
      if (input.role === UserRole.ADMIN && !isAdminMobile(before.mobile)) {
        throw asUserError(
          "admin_mobile_required",
          "نقش مدیر فقط برای موبایل‌های ADMIN_MOBILES مجاز است.",
        );
      }
      if (
        before.role === UserRole.ADMIN &&
        input.role === UserRole.CUSTOMER &&
        before.id === input.actorUserId
      ) {
        throw asUserError(
          "cannot_demote_self",
          "نمی‌توانید نقش خودتان را از مدیر خارج کنید.",
        );
      }
      nextRole = input.role;
    }

    const nextName =
      input.displayName === undefined
        ? before.displayName
        : input.displayName === null || input.displayName.trim() === ""
          ? null
          : input.displayName.trim().slice(0, 120);

    const saved = await tx.user.update({
      where: { id: before.id },
      data: {
        displayName: nextName,
        role: nextRole,
      },
    });

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action:
          before.role !== saved.role
            ? AuditActions.ROLE_CHANGE
            : AuditActions.USER_UPDATE,
        entityType: "user",
        entityId: saved.id,
        beforeData: {
          displayName: before.displayName,
          role: before.role,
        },
        afterData: {
          displayName: saved.displayName,
          role: saved.role,
          reason: command.reason,
        },
        idempotencyKey: command.receiptKey,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    const result = { userId: saved.id };
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}

export async function adminSetUserBlock(input: {
  actorUserId: string;
  userId: string;
  blocked: boolean;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: input.blocked ? "user_block" : "user_unblock",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: { userId: input.userId, blocked: input.blocked },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as { userId: string; accountStatus: string };

    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before) throw asUserError("user_not_found", "کاربر پیدا نشد.");
    if (before.id === input.actorUserId) {
      throw asUserError("cannot_block_self", "مسدود کردن خودتان مجاز نیست.");
    }

    const saved = await tx.user.update({
      where: { id: before.id },
      data: input.blocked
        ? {
            accountStatus: UserAccountStatus.BLOCKED,
            blockedAt: new Date(),
            blockedReason: command.reason,
          }
        : {
            accountStatus: UserAccountStatus.ACTIVE,
            blockedAt: null,
            blockedReason: null,
          },
    });

    if (input.blocked) {
      await tx.session.updateMany({
        where: { userId: before.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.wallet.updateMany({
        where: { userId: before.id },
        data: { status: WalletStatus.FROZEN },
      });
    } else {
      await tx.wallet.updateMany({
        where: { userId: before.id },
        data: { status: WalletStatus.ACTIVE },
      });
    }

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: input.blocked
          ? AuditActions.USER_BLOCK
          : AuditActions.USER_UNBLOCK,
        entityType: "user",
        entityId: saved.id,
        beforeData: {
          accountStatus: before.accountStatus,
          blockedReason: before.blockedReason,
        },
        afterData: {
          accountStatus: saved.accountStatus,
          blockedReason: saved.blockedReason,
          reason: command.reason,
        },
        idempotencyKey: command.receiptKey,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    const result = {
      userId: saved.id,
      accountStatus: saved.accountStatus,
    };
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}

async function reassignCloudInstanceOwnershipTx(
  tx: Prisma.TransactionClient,
  input: {
    cloudInstanceId: string;
    targetUserId: string;
  },
) {
  const instance = await tx.cloudInstance.findUnique({
    where: { id: input.cloudInstanceId },
    include: {
      infrastructureOrder: true,
      subscription: true,
    },
  });
  if (!instance) {
    throw asUserError("instance_not_found", "سرور پیدا نشد.");
  }
  if (instance.userId === input.targetUserId) {
    throw asUserError(
      "already_owner",
      "این سرور از قبل متعلق به همان کاربر است.",
    );
  }

  const target = await tx.user.findUnique({
    where: { id: input.targetUserId },
  });
  if (!target) throw asUserError("user_not_found", "کاربر مقصد پیدا نشد.");
  if (target.accountStatus === UserAccountStatus.BLOCKED) {
    throw asUserError(
      "target_blocked",
      "کاربر مقصد مسدود است و نمی‌توان سرور به او وصل کرد.",
    );
  }

  const fromUserId = instance.userId;
  await tx.cloudInstance.update({
    where: { id: instance.id },
    data: { userId: target.id },
  });
  await tx.infrastructureOrder.update({
    where: { id: instance.infrastructureOrderId },
    data: { userId: target.id },
  });
  await tx.serviceOrder.update({
    where: { id: instance.infrastructureOrder.serviceOrderId },
    data: { userId: target.id },
  });
  if (instance.subscription) {
    await tx.serviceSubscription.update({
      where: { id: instance.subscription.id },
      data: { userId: target.id },
    });
    await tx.serviceRenewalQuote.updateMany({
      where: { subscriptionId: instance.subscription.id },
      data: { userId: target.id },
    });
  }

  return {
    cloudInstanceId: instance.id,
    fromUserId,
    toUserId: target.id,
    infrastructureOrderId: instance.infrastructureOrderId,
    serviceOrderId: instance.infrastructureOrder.serviceOrderId,
  };
}

export async function adminTransferServer(input: {
  actorUserId: string;
  cloudInstanceId: string;
  fromUserId: string;
  toUserId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "user_transfer_server",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      cloudInstanceId: input.cloudInstanceId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
    },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as Record<string, string>;

    const instance = await tx.cloudInstance.findUnique({
      where: { id: input.cloudInstanceId },
      select: { userId: true },
    });
    if (!instance) throw asUserError("instance_not_found", "سرور پیدا نشد.");
    if (instance.userId !== input.fromUserId) {
      throw asUserError(
        "source_mismatch",
        "سرور متعلق به کاربر مبدأ نیست.",
      );
    }

    const moved = await reassignCloudInstanceOwnershipTx(tx, {
      cloudInstanceId: input.cloudInstanceId,
      targetUserId: input.toUserId,
    });

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.USER_TRANSFER_SERVER,
        entityType: "cloud_instance",
        entityId: moved.cloudInstanceId,
        beforeData: { userId: moved.fromUserId },
        afterData: {
          userId: moved.toUserId,
          reason: command.reason,
          serviceOrderId: moved.serviceOrderId,
        },
        idempotencyKey: command.receiptKey,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    await persistAdminCommandReceiptTx(tx, command, moved);
    return moved;
  });
}

export async function adminAttachServer(input: {
  actorUserId: string;
  targetUserId: string;
  cloudInstanceId: string;
  reason: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "user_attach_server",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      targetUserId: input.targetUserId,
      cloudInstanceId: input.cloudInstanceId,
    },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as Record<string, string>;

    const moved = await reassignCloudInstanceOwnershipTx(tx, {
      cloudInstanceId: input.cloudInstanceId,
      targetUserId: input.targetUserId,
    });

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.USER_ATTACH_SERVER,
        entityType: "cloud_instance",
        entityId: moved.cloudInstanceId,
        beforeData: { userId: moved.fromUserId },
        afterData: {
          userId: moved.toUserId,
          reason: command.reason,
        },
        idempotencyKey: command.receiptKey,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    await persistAdminCommandReceiptTx(tx, command, moved);
    return moved;
  });
}

export async function adminDeleteUser(input: {
  actorUserId: string;
  userId: string;
  reason: string;
  confirmMobile: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const command = normalizeAdminCommand({
    operation: "user_delete",
    idempotencyKey: input.idempotencyKey,
    actorUserId: input.actorUserId,
    reason: input.reason,
    payload: {
      userId: input.userId,
      confirmMobile: input.confirmMobile,
    },
  });

  return prisma.$transaction(async (tx) => {
    await assertAdminActorTx(tx, input.actorUserId);
    const replay = await replayAdminCommandTx(tx, command);
    if (replay) return replay as { deletedUserId: string; mobile: string };

    const before = await tx.user.findUnique({
      where: { id: input.userId },
      include: {
        wallet: true,
        cloudInstances: { select: { id: true, status: true } },
        _count: { select: { adminCommandReceipts: true } },
      },
    });
    if (!before) throw asUserError("user_not_found", "کاربر پیدا نشد.");
    if (before.id === input.actorUserId) {
      throw asUserError("cannot_delete_self", "حذف خودتان مجاز نیست.");
    }
    if (before.mobile !== input.confirmMobile.trim()) {
      throw asUserError(
        "confirm_mobile_mismatch",
        "برای حذف کامل باید موبایل کاربر را دقیقاً تأیید کنید.",
      );
    }
    if (before._count.adminCommandReceipts > 0) {
      throw asUserError(
        "has_admin_commands",
        "این کاربر سابقه فرمان Admin دارد و حذف کامل مجاز نیست؛ مسدود کنید.",
      );
    }
    if (before.cloudInstances.length > 0) {
      throw asUserError(
        "has_servers",
        "ابتدا همه سرورها را منتقل یا تعیین‌تکلیف کنید؛ حذف با سرور موجود ممنوع است.",
      );
    }
    if (
      before.wallet &&
      before.wallet.availableBalance !== 0n
    ) {
      throw asUserError(
        "wallet_not_empty",
        "موجودی کیف پول باید صفر باشد؛ ابتدا تعدیل یا مصرف شود.",
      );
    }
    const activeInstances = before.cloudInstances.filter(
      (row) => row.status !== CloudInstanceStatus.TERMINATED,
    );
    if (activeInstances.length > 0) {
      throw asUserError("has_active_servers", "سرور فعال باقی مانده است.");
    }

    await writeAuditLog(
      {
        actorUserId: input.actorUserId,
        action: AuditActions.USER_DELETE,
        entityType: "user",
        entityId: before.id,
        beforeData: {
          mobile: before.mobile,
          displayName: before.displayName,
          role: before.role,
          accountStatus: before.accountStatus,
        },
        afterData: { deleted: true, reason: command.reason },
        idempotencyKey: `${command.receiptKey}:audit`,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    await tx.user.delete({ where: { id: before.id } });
    const result = { deletedUserId: before.id, mobile: before.mobile };
    await persistAdminCommandReceiptTx(tx, command, result);
    return result;
  });
}
