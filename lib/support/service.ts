import {
  ParchinLevel,
  SupportRequestCategory,
  SupportRequestPriority,
  SupportRequestStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { supportPriorityFromParchin } from "@/lib/labels/customer";
import { WalletError } from "@/lib/wallet/errors";

const CATEGORIES = new Set<string>(Object.values(SupportRequestCategory));

export function parseSupportCategory(
  value: unknown,
): SupportRequestCategory | null {
  return typeof value === "string" && CATEGORIES.has(value)
    ? (value as SupportRequestCategory)
    : null;
}

function priorityForLevel(
  level: ParchinLevel | null | undefined,
): SupportRequestPriority {
  const mapped = supportPriorityFromParchin(level ?? null);
  return SupportRequestPriority[mapped];
}

async function resolveLinkedParchin(input: {
  userId: string;
  cloudInstanceId?: string | null;
  serviceOrderId?: string | null;
}): Promise<{
  cloudInstanceId: string | null;
  serviceOrderId: string | null;
  parchinLevel: ParchinLevel | null;
}> {
  if (input.cloudInstanceId) {
    const instance = await prisma.cloudInstance.findFirst({
      where: { id: input.cloudInstanceId, userId: input.userId },
      include: {
        infrastructureOrder: {
          include: { serviceOrder: { select: { id: true, parchinLevel: true } } },
        },
      },
    });
    if (!instance) {
      throw new WalletError("not_found", "سرویس انتخاب‌شده پیدا نشد.");
    }
    return {
      cloudInstanceId: instance.id,
      serviceOrderId: instance.infrastructureOrder.serviceOrder.id,
      parchinLevel: instance.infrastructureOrder.serviceOrder.parchinLevel,
    };
  }
  if (input.serviceOrderId) {
    const order = await prisma.serviceOrder.findFirst({
      where: { id: input.serviceOrderId, userId: input.userId },
      select: { id: true, parchinLevel: true },
    });
    if (!order) {
      throw new WalletError("not_found", "سفارش انتخاب‌شده پیدا نشد.");
    }
    return {
      cloudInstanceId: null,
      serviceOrderId: order.id,
      parchinLevel: order.parchinLevel,
    };
  }
  return { cloudInstanceId: null, serviceOrderId: null, parchinLevel: null };
}

export async function createSupportRequest(input: {
  userId: string;
  category: SupportRequestCategory;
  subject: string;
  description: string;
  cloudInstanceId?: string | null;
  serviceOrderId?: string | null;
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
  const linked = await resolveLinkedParchin({
    userId: input.userId,
    cloudInstanceId: input.cloudInstanceId,
    serviceOrderId: input.serviceOrderId,
  });
  return prisma.supportRequest.create({
    data: {
      userId: input.userId,
      category: input.category,
      subject,
      description,
      cloudInstanceId: linked.cloudInstanceId,
      serviceOrderId: linked.serviceOrderId,
      parchinLevel: linked.parchinLevel,
      priority: priorityForLevel(linked.parchinLevel),
      status: SupportRequestStatus.OPEN,
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
        ...(input.status === SupportRequestStatus.OPEN ||
        input.status === SupportRequestStatus.IN_PROGRESS ||
        !input.status
          ? {}
          : {}),
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
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    cloudInstanceId: request.cloudInstanceId,
    serviceOrderId: request.serviceOrderId,
  };
}
