import {
  ParchinEnrollmentStatus,
  ParchinLevel,
  ParchinReportStatus,
  ParchinReportType,
  ParchinTaskStatus,
  type Prisma,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import {
  completeParchinTaskTx,
} from "@/lib/parchin/operations";
import {
  snapshotParchinServiceContract,
  toParchinServiceContract,
} from "@/lib/parchin/service-contract";
import { WalletError } from "@/lib/wallet/errors";
import { isParchinConfigSellable } from "@/lib/parchin/sellable";

export async function listCustomerParchinEnrollments(userId: string) {
  return prisma.parchinEnrollment.findMany({
    where: { userId },
    orderBy: { activatedAt: "desc" },
    include: {
      cloudInstance: {
        select: { id: true, name: true, ipv4: true, status: true },
      },
      subscription: {
        select: {
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          nextRenewalAt: true,
        },
      },
      _count: {
        select: {
          tasks: { where: { status: { notIn: ["COMPLETED", "CANCELED"] } } },
          reports: { where: { status: "PUBLISHED" } },
          supportRequests: {
            where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
          },
        },
      },
    },
  });
}

export async function getCustomerParchinEnrollment(
  userId: string,
  enrollmentId: string,
) {
  const enrollment = await prisma.parchinEnrollment.findFirst({
    where: { id: enrollmentId, userId },
    include: {
      cloudInstance: {
        select: { id: true, name: true, ipv4: true, status: true },
      },
      serviceOrder: { select: { id: true, title: true } },
      subscription: true,
      tasks: {
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: 100,
      },
      reports: {
        where: { status: ParchinReportStatus.PUBLISHED },
        orderBy: [{ periodEnd: "desc" }, { publishedAt: "desc" }],
        take: 24,
      },
      supportRequests: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
  if (!enrollment) {
    throw new WalletError("not_found", "قرارداد پرچین پیدا نشد.");
  }
  return enrollment;
}

export async function listAdminParchinEnrollments(filters?: {
  level?: ParchinLevel | null;
  status?: ParchinEnrollmentStatus | null;
  query?: string | null;
}) {
  const query = filters?.query?.trim() ?? "";
  const where: Prisma.ParchinEnrollmentWhereInput = {
    level: filters?.level ?? undefined,
    status: filters?.status ?? undefined,
    ...(query
      ? {
          OR: [
            { cloudInstance: { name: { contains: query, mode: "insensitive" } } },
            { cloudInstance: { ipv4: { contains: query } } },
            { user: { mobile: { contains: query } } },
            { user: { displayName: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  return prisma.parchinEnrollment.findMany({
    where,
    orderBy: [{ status: "asc" }, { activatedAt: "desc" }],
    take: 250,
    include: {
      user: { select: { id: true, displayName: true, mobile: true } },
      cloudInstance: {
        select: { id: true, name: true, ipv4: true, status: true },
      },
      subscription: {
        select: { status: true, currentPeriodEnd: true, nextRenewalAt: true },
      },
      _count: {
        select: {
          tasks: { where: { status: { notIn: ["COMPLETED", "CANCELED"] } } },
          reports: { where: { status: "PUBLISHED" } },
          supportRequests: {
            where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
          },
        },
      },
    },
  });
}

export async function getAdminParchinOperations() {
  const now = new Date();
  const dueSoon = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const [activeContracts, overdueTasks, dueSoonTasks, p1Requests, slaBreaches] =
    await Promise.all([
      prisma.parchinEnrollment.count({
        where: { status: ParchinEnrollmentStatus.ACTIVE },
      }),
      prisma.parchinTask.count({
        where: {
          status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
          dueAt: { lt: now },
        },
      }),
      prisma.parchinTask.count({
        where: {
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueAt: { gte: now, lte: dueSoon },
        },
      }),
      prisma.supportRequest.count({
        where: {
          kind: "P1_INCIDENT",
          status: { in: ["OPEN", "IN_PROGRESS"] },
        },
      }),
      prisma.supportRequest.count({
        where: {
          status: { in: ["OPEN", "IN_PROGRESS"] },
          firstRespondedAt: null,
          firstResponseDueAt: { lt: now },
        },
      }),
    ]);
  return { activeContracts, overdueTasks, dueSoonTasks, p1Requests, slaBreaches };
}

export async function getAdminParchinEnrollment(enrollmentId: string) {
  const enrollment = await prisma.parchinEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { select: { id: true, displayName: true, mobile: true } },
      cloudInstance: true,
      serviceOrder: { select: { id: true, title: true } },
      subscription: true,
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        take: 250,
        include: {
          assignedTo: { select: { id: true, displayName: true, mobile: true } },
          completedBy: { select: { id: true, displayName: true, mobile: true } },
        },
      },
      reports: {
        orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
        take: 100,
        include: {
          createdBy: { select: { id: true, displayName: true, mobile: true } },
        },
      },
      supportRequests: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          assignedTo: { select: { id: true, displayName: true, mobile: true } },
        },
      },
    },
  });
  if (!enrollment) {
    throw new WalletError("not_found", "قرارداد پرچین پیدا نشد.");
  }
  return enrollment;
}

export async function updateParchinTask(input: {
  taskId: string;
  adminUserId: string;
  status?: ParchinTaskStatus;
  assignedToId?: string | null;
  evidenceSummary?: string;
  blockedReason?: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "ParchinTask" WHERE id = ${input.taskId} FOR UPDATE
    `;
    const before = await tx.parchinTask.findUnique({
      where: { id: input.taskId },
      include: { enrollment: { select: { status: true } } },
    });
    if (!before) throw new WalletError("not_found", "وظیفه پرچین پیدا نشد.");
    if (before.enrollment.status !== "ACTIVE") {
      throw new WalletError("invalid_status", "قرارداد پرچین فعال نیست.");
    }
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
    let after;
    if (input.status === ParchinTaskStatus.COMPLETED) {
      after = await completeParchinTaskTx(tx, {
        taskId: before.id,
        adminUserId: input.adminUserId,
        evidenceSummary: input.evidenceSummary ?? "",
      });
    } else {
      const blockedReason = input.blockedReason?.trim() ?? "";
      if (
        input.status === ParchinTaskStatus.BLOCKED &&
        (blockedReason.length < 3 || blockedReason.length > 1_000)
      ) {
        throw new WalletError("invalid_input", "علت مسدودی وظیفه معتبر نیست.");
      }
      after = await tx.parchinTask.update({
        where: { id: before.id },
        data: {
          status: input.status,
          assignedToId:
            input.assignedToId === undefined ? undefined : input.assignedToId,
          startedAt:
            input.status === ParchinTaskStatus.IN_PROGRESS
              ? before.startedAt ?? new Date()
              : undefined,
          blockedReason:
            input.status === ParchinTaskStatus.BLOCKED
              ? blockedReason
              : input.status
                ? null
                : undefined,
        },
      });
    }
    await writeAuditLog(
      {
        actorUserId: input.adminUserId,
        action: AuditActions.PARCHIN_TASK_UPDATE,
        entityType: "parchin_task",
        entityId: before.id,
        beforeData: {
          status: before.status,
          assignedToId: before.assignedToId,
        },
        afterData: {
          status: after.status,
          assignedToId: after.assignedToId,
          completedAt: after.completedAt?.toISOString() ?? null,
        },
      },
      tx,
    );
    return after;
  });
}

export async function createParchinReport(input: {
  enrollmentId: string;
  adminUserId: string;
  type: ParchinReportType;
  title: string;
  summary: string;
  periodStart: Date;
  periodEnd: Date;
  metrics: Prisma.InputJsonObject;
  recommendations: string[];
  publish: boolean;
}) {
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (title.length < 3 || title.length > 160) {
    throw new WalletError("invalid_input", "عنوان گزارش معتبر نیست.");
  }
  if (summary.length < 10 || summary.length > 8_000) {
    throw new WalletError("invalid_input", "خلاصه گزارش معتبر نیست.");
  }
  if (input.periodEnd.getTime() < input.periodStart.getTime()) {
    throw new WalletError("invalid_input", "بازه گزارش معتبر نیست.");
  }
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.parchinEnrollment.findUnique({
      where: { id: input.enrollmentId },
    });
    if (!enrollment) throw new WalletError("not_found", "قرارداد پرچین پیدا نشد.");
    if (enrollment.status !== "ACTIVE") {
      throw new WalletError("invalid_status", "قرارداد پرچین فعال نیست.");
    }
    const report = await tx.parchinReport.create({
      data: {
        enrollmentId: enrollment.id,
        createdById: input.adminUserId,
        type: input.type,
        status: input.publish
          ? ParchinReportStatus.PUBLISHED
          : ParchinReportStatus.DRAFT,
        title,
        summary,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        metrics: input.metrics,
        recommendations: input.recommendations
          .map((item) => item.trim())
          .filter(Boolean),
        publishedAt: input.publish ? new Date() : null,
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.adminUserId,
        action: AuditActions.PARCHIN_REPORT_CREATE,
        entityType: "parchin_report",
        entityId: report.id,
        afterData: {
          enrollmentId: enrollment.id,
          type: report.type,
          status: report.status,
          periodStart: report.periodStart.toISOString(),
          periodEnd: report.periodEnd.toISOString(),
        },
      },
      tx,
    );
    return report;
  });
}

function levelRank(level: ParchinLevel): number {
  if (level === ParchinLevel.PARCHIN_STABLE) return 3;
  if (level === ParchinLevel.PARCHIN_ACTIVE) return 2;
  return 1;
}

export async function requestParchinLevelUpgrade(input: {
  enrollmentId: string;
  userId: string;
  requestedLevel: ParchinLevel;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "ParchinEnrollment"
      WHERE id = ${input.enrollmentId} FOR UPDATE
    `;
    const enrollment = await tx.parchinEnrollment.findFirst({
      where: { id: input.enrollmentId, userId: input.userId },
    });
    if (!enrollment) throw new WalletError("not_found", "قرارداد پرچین پیدا نشد.");
    if (enrollment.status !== "ACTIVE") {
      throw new WalletError("invalid_status", "قرارداد پرچین فعال نیست.");
    }
    if (levelRank(input.requestedLevel) <= levelRank(enrollment.level)) {
      throw new WalletError(
        "invalid_input",
        "سطح درخواستی باید بالاتر از سطح فعلی باشد.",
      );
    }
    const config = await tx.parchinPricingConfig.findFirst({
      where: { level: input.requestedLevel, active: true },
    });
    if (!config || !isParchinConfigSellable(config)) throw new WalletError("not_found", "سطح پرچین قابل انتخاب نیست.");
    const updated = await tx.parchinEnrollment.update({
      where: { id: enrollment.id },
      data: {
        requestedNextLevel: input.requestedLevel,
        requestedLevelAt: new Date(),
      },
    });
    if (enrollment.subscriptionId) {
      await tx.serviceSubscription.update({
        where: { id: enrollment.subscriptionId },
        data: { parchinLevel: input.requestedLevel },
      });
      await tx.serviceRenewalQuote.updateMany({
        where: {
          subscriptionId: enrollment.subscriptionId,
          status: "ACTIVE",
        },
        data: { status: "INVALIDATED" },
      });
    }
    await tx.parchinTask.upsert({
      where: { idempotencyKey: `parchin-level-change:${enrollment.id}:${input.requestedLevel}` },
      update: { status: ParchinTaskStatus.TODO, dueAt: enrollment.quotaPeriodEnd },
      create: {
        enrollmentId: enrollment.id,
        type: "CHANGE_MANAGEMENT",
        templateKey: "parchin-level-change",
        title: `ارتقای پرچین به ${config.title}`,
        description: "قیمت و دامنه قرارداد دوره بعد را بررسی و تغییر سطح را در تمدید اعمال کن.",
        priority: "HIGH",
        recurrence: "ONCE",
        dueAt: enrollment.quotaPeriodEnd,
        idempotencyKey: `parchin-level-change:${enrollment.id}:${input.requestedLevel}`,
        evidence: {
          requestedLevel: input.requestedLevel,
          contractSnapshot: snapshotParchinServiceContract(
            toParchinServiceContract(config),
          ),
        },
      },
    });
    await writeAuditLog(
      {
        actorUserId: input.userId,
        action: AuditActions.PARCHIN_LEVEL_REQUEST,
        entityType: "parchin_enrollment",
        entityId: enrollment.id,
        beforeData: { requestedNextLevel: enrollment.requestedNextLevel },
        afterData: { requestedNextLevel: input.requestedLevel },
      },
      tx,
    );
    return updated;
  });
}

export function parchinEnrollmentRoutineRemaining(enrollment: {
  routineRequestLimit: number;
  routineRequestsUsed: number;
}) {
  return Math.max(
    0,
    enrollment.routineRequestLimit - enrollment.routineRequestsUsed,
  );
}
