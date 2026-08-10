import {
  ParchinLevel,
  SupportRequestCategory,
  SupportRequestKind,
  SupportRequestPriority,
  SupportRequestStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { supportPriorityFromParchin } from "@/lib/labels/customer";
import {
  createP1IncidentTaskTx,
  parchinFirstResponseDueAt,
} from "@/lib/parchin/operations";
import { addBillingMonths } from "@/lib/subscriptions/period";
import { WalletError } from "@/lib/wallet/errors";

const CATEGORIES = new Set<string>(Object.values(SupportRequestCategory));
const KINDS = new Set<string>(Object.values(SupportRequestKind));
type Db = PrismaClient | Prisma.TransactionClient;

export function parseSupportCategory(
  value: unknown,
): SupportRequestCategory | null {
  return typeof value === "string" && CATEGORIES.has(value)
    ? (value as SupportRequestCategory)
    : null;
}

export function parseSupportKind(value: unknown): SupportRequestKind | null {
  return typeof value === "string" && KINDS.has(value)
    ? (value as SupportRequestKind)
    : null;
}

function priorityForLevel(
  level: ParchinLevel | null | undefined,
): SupportRequestPriority {
  const mapped = supportPriorityFromParchin(level ?? null);
  return SupportRequestPriority[mapped];
}

async function resolveLinkedParchin(db: Db, input: {
  userId: string;
  cloudInstanceId?: string | null;
  serviceOrderId?: string | null;
}): Promise<{
  cloudInstanceId: string | null;
  serviceOrderId: string | null;
  parchinLevel: ParchinLevel | null;
  parchinEnrollmentId: string | null;
}> {
  if (input.cloudInstanceId) {
    const instance = await db.cloudInstance.findFirst({
      where: { id: input.cloudInstanceId, userId: input.userId },
      include: {
        parchinEnrollment: true,
        infrastructureOrder: {
          include: { serviceOrder: { select: { id: true } } },
        },
      },
    });
    if (!instance) {
      throw new WalletError("not_found", "سرویس انتخاب‌شده پیدا نشد.");
    }
    const activeEnrollment =
      instance.parchinEnrollment?.status === "ACTIVE"
        ? instance.parchinEnrollment
        : null;
    return {
      cloudInstanceId: instance.id,
      serviceOrderId: instance.infrastructureOrder.serviceOrder.id,
      parchinLevel: activeEnrollment?.level ?? null,
      parchinEnrollmentId: activeEnrollment?.id ?? null,
    };
  }
  if (input.serviceOrderId) {
    const order = await db.serviceOrder.findFirst({
      where: { id: input.serviceOrderId, userId: input.userId },
      select: {
        id: true,
        parchinEnrollment: { select: { id: true, level: true, status: true } },
      },
    });
    if (!order) {
      throw new WalletError("not_found", "سفارش انتخاب‌شده پیدا نشد.");
    }
    const activeEnrollment =
      order.parchinEnrollment?.status === "ACTIVE"
        ? order.parchinEnrollment
        : null;
    return {
      cloudInstanceId: null,
      serviceOrderId: order.id,
      parchinLevel: activeEnrollment?.level ?? null,
      parchinEnrollmentId: activeEnrollment?.id ?? null,
    };
  }
  return {
    cloudInstanceId: null,
    serviceOrderId: null,
    parchinLevel: null,
    parchinEnrollmentId: null,
  };
}

export async function createSupportRequest(input: {
  userId: string;
  category: SupportRequestCategory;
  subject: string;
  description: string;
  cloudInstanceId?: string | null;
  serviceOrderId?: string | null;
  kind?: SupportRequestKind;
}) {
  const subject = input.subject.trim();
  const description = input.description.trim();
  if (subject.length < 3 || subject.length > 160) {
    throw new WalletError("invalid_input", "موضوع باید بین ۳ تا ۱۶۰ کاراکتر باشد.");
  }
  if (description.length < 10 || description.length > 4000) {
    throw new WalletError(
      "invalid_input",
      "توضیحات باید بین ۱۰ تا ۴۰۰۰ کاراکتر باشد.",
    );
  }
  const kind = input.kind ?? SupportRequestKind.GENERAL;
  return prisma.$transaction(async (tx) => {
    const linked = await resolveLinkedParchin(tx, {
      userId: input.userId,
      cloudInstanceId: input.cloudInstanceId,
      serviceOrderId: input.serviceOrderId,
    });
    if (
      (kind === SupportRequestKind.ROUTINE ||
        kind === SupportRequestKind.P1_INCIDENT) &&
      (!linked.parchinEnrollmentId || !linked.parchinLevel)
    ) {
      throw new WalletError(
        "parchin_required",
        "برای این نوع درخواست باید یک سرویس فعال پرچین انتخاب شود.",
      );
    }
    if (
      kind === SupportRequestKind.P1_INCIDENT &&
      linked.parchinLevel !== ParchinLevel.PARCHIN_STABLE
    ) {
      throw new WalletError(
        "p1_not_included",
        "ثبت رخداد P1 فقط برای پرچین کهکشان فعال است.",
      );
    }

    let quotaConsumed = false;
    if (kind === SupportRequestKind.ROUTINE && linked.parchinEnrollmentId) {
      await tx.$queryRaw`
        SELECT id FROM "ParchinEnrollment"
        WHERE id = ${linked.parchinEnrollmentId}
        FOR UPDATE
      `;
      let enrollment = await tx.parchinEnrollment.findUniqueOrThrow({
        where: { id: linked.parchinEnrollmentId },
      });
      const now = new Date();
      if (enrollment.quotaPeriodEnd.getTime() <= now.getTime()) {
        enrollment = await tx.parchinEnrollment.update({
          where: { id: enrollment.id },
          data: {
            quotaPeriodStart: now,
            quotaPeriodEnd: addBillingMonths(now, 1),
            routineRequestsUsed: 0,
          },
        });
      }
      if (enrollment.routineRequestsUsed >= enrollment.routineRequestLimit) {
        throw new WalletError(
          "routine_quota_exhausted",
          "سهمیه درخواست روتین این دوره مصرف شده است.",
        );
      }
      await tx.parchinEnrollment.update({
        where: { id: enrollment.id },
        data: { routineRequestsUsed: { increment: 1 } },
      });
      quotaConsumed = true;
    }

    const createdAt = new Date();
    const firstResponseDueAt = linked.parchinLevel
      ? parchinFirstResponseDueAt({
          level: linked.parchinLevel,
          kind,
          createdAt,
        })
      : null;
    const created = await tx.supportRequest.create({
      data: {
        userId: input.userId,
        category: input.category,
        kind,
        subject,
        description,
        cloudInstanceId: linked.cloudInstanceId,
        serviceOrderId: linked.serviceOrderId,
        parchinEnrollmentId: linked.parchinEnrollmentId,
        parchinLevel: linked.parchinLevel,
        priority:
          kind === SupportRequestKind.P1_INCIDENT
            ? SupportRequestPriority.URGENT
            : priorityForLevel(linked.parchinLevel),
        status: SupportRequestStatus.OPEN,
        firstResponseDueAt,
        routineQuotaConsumed: quotaConsumed,
        p1DeclaredAt:
          kind === SupportRequestKind.P1_INCIDENT ? createdAt : null,
        createdAt,
        messages: {
          create: {
            authorUserId: input.userId,
            body: description,
            isStaff: false,
          },
        },
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (
      kind === SupportRequestKind.P1_INCIDENT &&
      linked.parchinEnrollmentId &&
      firstResponseDueAt
    ) {
      await createP1IncidentTaskTx(tx, {
        enrollmentId: linked.parchinEnrollmentId,
        supportRequestId: created.id,
        dueAt: firstResponseDueAt,
        subject,
      });
    }
    return created;
  });
}

export async function listCustomerSupportRequests(userId: string) {
  return prisma.supportRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getCustomerSupportRequest(userId: string, id: string) {
  const request = await prisma.supportRequest.findFirst({
    where: { id, userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, displayName: true, role: true } },
        },
      },
      cloudInstance: { select: { id: true, name: true, ipv4: true } },
      serviceOrder: { select: { id: true, title: true } },
    },
  });
  if (!request) {
    throw new WalletError("not_found", "درخواست پشتیبانی پیدا نشد.");
  }
  return request;
}

export async function addCustomerSupportMessage(input: {
  userId: string;
  requestId: string;
  body: string;
}) {
  const body = input.body.trim();
  if (body.length < 1 || body.length > 4000) {
    throw new WalletError("invalid_input", "پیام معتبر نیست.");
  }
  const request = await prisma.supportRequest.findFirst({
    where: { id: input.requestId, userId: input.userId },
  });
  if (!request) {
    throw new WalletError("not_found", "درخواست پشتیبانی پیدا نشد.");
  }
  if (
    request.status === SupportRequestStatus.CLOSED ||
    request.status === SupportRequestStatus.RESOLVED
  ) {
    throw new WalletError(
      "invalid_status",
      "این درخواست بسته شده و پیام جدید نمی‌پذیرد.",
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.supportRequestMessage.create({
      data: {
        requestId: request.id,
        authorUserId: input.userId,
        body,
        isStaff: false,
      },
    });
    if (request.status === SupportRequestStatus.RESOLVED) {
      await tx.supportRequest.update({
        where: { id: request.id },
        data: { status: SupportRequestStatus.OPEN },
      });
    }
    return tx.supportRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  });
}

export async function listAdminSupportRequests(filters?: {
  status?: SupportRequestStatus | null;
  priority?: SupportRequestPriority | null;
}) {
  const where: Prisma.SupportRequestWhereInput = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.priority) where.priority = filters.priority;
  return prisma.supportRequest.findMany({
    where,
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      user: { select: { id: true, mobile: true, displayName: true } },
      cloudInstance: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, displayName: true, mobile: true } },
    },
  });
}

export async function getAdminSupportRequest(id: string) {
  const request = await prisma.supportRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, mobile: true, displayName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, displayName: true, role: true } },
        },
      },
      cloudInstance: { select: { id: true, name: true, ipv4: true } },
      serviceOrder: { select: { id: true, title: true, parchinLevel: true } },
      parchinEnrollment: {
        select: {
          id: true,
          routineRequestLimit: true,
          routineRequestsUsed: true,
        },
      },
      assignedTo: { select: { id: true, displayName: true, mobile: true } },
    },
  });
  if (!request) {
    throw new WalletError("not_found", "درخواست پشتیبانی پیدا نشد.");
  }
  return request;
}

export async function adminUpdateSupportRequest(input: {
  adminUserId: string;
  requestId: string;
  status?: SupportRequestStatus;
  reply?: string;
  assignedToId?: string | null;
}) {
  const request = await prisma.supportRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!request) {
    throw new WalletError("not_found", "درخواست پشتیبانی پیدا نشد.");
  }
  const reply = input.reply?.trim() ?? "";
  if (input.reply != null && (reply.length < 1 || reply.length > 4000)) {
    throw new WalletError("invalid_input", "پاسخ معتبر نیست.");
  }
  return prisma.$transaction(async (tx) => {
    if (input.assignedToId) {
      const assignee = await tx.user.findFirst({
        where: {
          id: input.assignedToId,
          role: "ADMIN",
          accountStatus: "ACTIVE",
        },
        select: { id: true },
      });
      if (!assignee) {
        throw new WalletError("invalid_input", "مسئول انتخاب‌شده ادمین فعال نیست.");
      }
    }
    if (reply) {
      await tx.supportRequestMessage.create({
        data: {
          requestId: request.id,
          authorUserId: input.adminUserId,
          body: reply,
          isStaff: true,
        },
      });
    }
    return tx.supportRequest.update({
      where: { id: request.id },
      data: {
        status: input.status ?? undefined,
        assignedToId:
          input.assignedToId === undefined ? undefined : input.assignedToId,
        firstRespondedAt:
          reply && !request.firstRespondedAt ? new Date() : undefined,
        resolvedAt:
          input.status === SupportRequestStatus.RESOLVED ||
          input.status === SupportRequestStatus.CLOSED
            ? request.resolvedAt ?? new Date()
            : input.status === SupportRequestStatus.OPEN ||
                input.status === SupportRequestStatus.IN_PROGRESS
              ? null
              : undefined,
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
  });
}

export function toPublicSupportRequest(
  request: {
    id: string;
    category: SupportRequestCategory;
    subject: string;
    description: string;
    status: SupportRequestStatus;
    priority: SupportRequestPriority;
    parchinLevel: ParchinLevel | null;
    kind: SupportRequestKind;
    firstResponseDueAt: Date | null;
    firstRespondedAt: Date | null;
    resolvedAt: Date | null;
    assignedToId: string | null;
    routineQuotaConsumed: boolean;
    createdAt: Date;
    updatedAt: Date;
    cloudInstanceId: string | null;
    serviceOrderId: string | null;
  },
) {
  return {
    id: request.id,
    category: request.category,
    subject: request.subject,
    description: request.description,
    status: request.status,
    priority: request.priority,
    parchinLevel: request.parchinLevel,
    kind: request.kind,
    firstResponseDueAt: request.firstResponseDueAt?.toISOString() ?? null,
    firstRespondedAt: request.firstRespondedAt?.toISOString() ?? null,
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
    assignedToId: request.assignedToId,
    routineQuotaConsumed: request.routineQuotaConsumed,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    cloudInstanceId: request.cloudInstanceId,
    serviceOrderId: request.serviceOrderId,
  };
}
