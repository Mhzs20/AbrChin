import {
  ParchinLevel,
  ParchinTaskPriority,
  ParchinTaskRecurrence,
  ParchinTaskStatus,
  ParchinTaskType,
  SupportRequestKind,
  type Prisma,
} from "@prisma/client";

import { addBillingMonths } from "@/lib/subscriptions/period";
import {
  defaultParchinContractForLevel,
  readParchinServiceSnapshot,
  snapshotParchinServiceContract,
  type ParchinServiceContract,
} from "@/lib/parchin/service-contract";

const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type LocalParts = {
  year: number;
  month: number;
  date: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function toTehranParts(value: Date): LocalParts {
  const shifted = new Date(value.getTime() + TEHRAN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    day: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

function fromTehranParts(parts: Omit<LocalParts, "day">): Date {
  return new Date(
    Date.UTC(
      parts.year,
      parts.month,
      parts.date,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ) - TEHRAN_OFFSET_MS,
  );
}

function workWindow(day: number): { start: number; end: number } | null {
  if (day === 5) return null;
  if (day === 4) return { start: 9, end: 14 };
  return { start: 9, end: 18 };
}

function atLocalHour(parts: LocalParts, hour: number): Date {
  return fromTehranParts({
    ...parts,
    hour,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

function nextWorkingOpen(value: Date): Date {
  let cursor = value;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const parts = toTehranParts(cursor);
    const window = workWindow(parts.day);
    if (window) {
      const open = atLocalHour(parts, window.start);
      const close = atLocalHour(parts, window.end);
      if (cursor.getTime() < open.getTime()) return open;
      if (cursor.getTime() < close.getTime()) return cursor;
    }
    const nextLocalDay = new Date(
      Date.UTC(parts.year, parts.month, parts.date) + DAY_MS - TEHRAN_OFFSET_MS,
    );
    const nextParts = toTehranParts(nextLocalDay);
    cursor = atLocalHour(nextParts, 9);
  }
  throw new Error("parchin_business_calendar_unresolvable");
}

/** Adds clock time only inside the locked Tehran business window. */
export function addParchinBusinessMinutes(
  createdAt: Date,
  minutes: number,
): Date {
  let cursor = nextWorkingOpen(createdAt);
  let remaining = Math.max(0, Math.trunc(minutes));
  while (remaining > 0) {
    const parts = toTehranParts(cursor);
    const window = workWindow(parts.day);
    if (!window) {
      cursor = nextWorkingOpen(new Date(cursor.getTime() + DAY_MS));
      continue;
    }
    const close = atLocalHour(parts, window.end);
    const available = Math.max(
      0,
      Math.floor((close.getTime() - cursor.getTime()) / 60_000),
    );
    if (remaining <= available) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= available;
    cursor = nextWorkingOpen(new Date(close.getTime() + 60_000));
  }
  return cursor;
}

export function endOfParchinWorkingDay(createdAt: Date): Date {
  const open = nextWorkingOpen(createdAt);
  const parts = toTehranParts(open);
  const window = workWindow(parts.day);
  if (!window) throw new Error("parchin_business_calendar_unresolvable");
  return atLocalHour(parts, window.end);
}

export function parchinFirstResponseDueAt(input: {
  level: ParchinLevel;
  kind: SupportRequestKind;
  createdAt?: Date;
}): Date {
  const createdAt = input.createdAt ?? new Date();
  if (
    input.level === ParchinLevel.PARCHIN_STABLE &&
    input.kind === SupportRequestKind.P1_INCIDENT
  ) {
    return new Date(createdAt.getTime() + 30 * 60_000);
  }
  if (input.level === ParchinLevel.PARCHIN_START) {
    return endOfParchinWorkingDay(createdAt);
  }
  return addParchinBusinessMinutes(createdAt, 4 * 60);
}

export function parchinRoutineLimit(level: ParchinLevel): number {
  if (level === ParchinLevel.PARCHIN_STABLE) return 4;
  if (level === ParchinLevel.PARCHIN_ACTIVE) return 2;
  return 1;
}

type TaskTemplate = {
  key: string;
  type: ParchinTaskType;
  title: string;
  description: string;
  priority: ParchinTaskPriority;
  recurrence: ParchinTaskRecurrence;
  delay: "NOW" | "DAY" | "WEEK" | "MONTH";
  minimumLevel: ParchinLevel;
};

const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    key: "initial-hardening",
    type: ParchinTaskType.INITIAL_HARDENING,
    title: "سخت‌سازی اولیه سرور",
    description: "Firewall، دسترسی و تنظیمات پایه را طبق چک‌لیست ثبت کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.ONCE,
    delay: "NOW",
    minimumLevel: ParchinLevel.PARCHIN_START,
  },
  {
    key: "initial-security-update",
    type: ParchinTaskType.INITIAL_SECURITY_UPDATE,
    title: "به‌روزرسانی امنیتی هنگام تحویل",
    description: "خروجی به‌روزرسانی امنیتی سیستم‌عامل را ثبت کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.ONCE,
    delay: "NOW",
    minimumLevel: ParchinLevel.PARCHIN_START,
  },
  {
    key: "resource-review",
    type: ParchinTaskType.RESOURCE_REVIEW,
    title: "بازبینی ماهانه منابع",
    description: "CPU، RAM، Disk و دسترسی‌ها را بازبینی و نتیجه را ثبت کن.",
    priority: ParchinTaskPriority.NORMAL,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_START,
  },
  {
    key: "health-report",
    type: ParchinTaskType.HEALTH_REPORT,
    title: "گزارش سلامت ماهانه",
    description: "گزارش سلامت و اقدام پیشنهادی مشتری را آماده کن.",
    priority: ParchinTaskPriority.NORMAL,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_START,
  },
  {
    key: "uptime-monitoring",
    type: ParchinTaskType.UPTIME_MONITORING,
    title: "کنترل پوشش پایش پنج‌دقیقه‌ای",
    description: "پایش، هشدار و مسیر رسیدگی را کنترل و ثبت کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.DAILY,
    delay: "DAY",
    minimumLevel: ParchinLevel.PARCHIN_ACTIVE,
  },
  {
    key: "daily-backup",
    type: ParchinTaskType.DAILY_BACKUP,
    title: "کنترل بکاپ روزانه",
    description: "موفقیت بکاپ، نگهداری نسخه‌ها و هشدار شکست را ثبت کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.DAILY,
    delay: "DAY",
    minimumLevel: ParchinLevel.PARCHIN_ACTIVE,
  },
  {
    key: "backup-restore-check",
    type: ParchinTaskType.BACKUP_RESTORE_CHECK,
    title: "بررسی ماهانه قابلیت بازیابی",
    description: "خوانایی و قابلیت استفاده آخرین بکاپ را بررسی کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_ACTIVE,
  },
  {
    key: "security-patch",
    type: ParchinTaskType.SECURITY_PATCH,
    title: "Patch امنیتی ماهانه",
    description: "تغییرات، نتیجه و برنامه بازگشت Patch را ثبت کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_ACTIVE,
  },
  {
    key: "operations-report",
    type: ParchinTaskType.OPERATIONS_REPORT,
    title: "گزارش عملیات ماهانه",
    description: "Uptime، بکاپ، منابع و Patch را برای مشتری منتشر کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_ACTIVE,
  },
  {
    key: "critical-monitoring",
    type: ParchinTaskType.CRITICAL_MONITORING,
    title: "کنترل پایش حیاتی ۲۴/۷",
    description: "پوشش On-call و مسیر رخداد P1 را کنترل کن.",
    priority: ParchinTaskPriority.CRITICAL,
    recurrence: ParchinTaskRecurrence.DAILY,
    delay: "DAY",
    minimumLevel: ParchinLevel.PARCHIN_STABLE,
  },
  {
    key: "restore-test",
    type: ParchinTaskType.RESTORE_TEST,
    title: "آزمون Restore ماهانه",
    description: "Restore واقعی را در محیط ایزوله اجرا و نتیجه را ثبت کن.",
    priority: ParchinTaskPriority.CRITICAL,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_STABLE,
  },
  {
    key: "security-review",
    type: ParchinTaskType.SECURITY_REVIEW,
    title: "بازبینی امنیتی هفتگی",
    description: "Patch، دسترسی و هشدارهای امنیتی را مرور کن.",
    priority: ParchinTaskPriority.CRITICAL,
    recurrence: ParchinTaskRecurrence.WEEKLY,
    delay: "WEEK",
    minimumLevel: ParchinLevel.PARCHIN_STABLE,
  },
  {
    key: "capacity-report",
    type: ParchinTaskType.CAPACITY_REPORT,
    title: "گزارش ظرفیت ماهانه",
    description: "روند منابع و ریسک گلوگاه را همراه پیشنهاد ثبت کن.",
    priority: ParchinTaskPriority.HIGH,
    recurrence: ParchinTaskRecurrence.MONTHLY,
    delay: "MONTH",
    minimumLevel: ParchinLevel.PARCHIN_STABLE,
  },
] as const;

function levelRank(level: ParchinLevel): number {
  if (level === ParchinLevel.PARCHIN_STABLE) return 3;
  if (level === ParchinLevel.PARCHIN_ACTIVE) return 2;
  return 1;
}

function initialDueAt(activatedAt: Date, delay: TaskTemplate["delay"]): Date {
  if (delay === "MONTH") return addBillingMonths(activatedAt, 1);
  if (delay === "WEEK") return new Date(activatedAt.getTime() + 7 * DAY_MS);
  if (delay === "DAY") return new Date(activatedAt.getTime() + DAY_MS);
  return activatedAt;
}

export function nextParchinTaskDueAt(
  dueAt: Date,
  recurrence: ParchinTaskRecurrence,
): Date | null {
  if (recurrence === ParchinTaskRecurrence.DAILY) {
    return new Date(dueAt.getTime() + DAY_MS);
  }
  if (recurrence === ParchinTaskRecurrence.WEEKLY) {
    return new Date(dueAt.getTime() + 7 * DAY_MS);
  }
  if (recurrence === ParchinTaskRecurrence.MONTHLY) {
    return addBillingMonths(dueAt, 1);
  }
  return null;
}

export async function activateParchinEnrollmentTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    cloudInstanceId: string;
    serviceOrderId: string;
    subscriptionId?: string | null;
    level: ParchinLevel;
    contractSnapshot: unknown;
    activatedAt: Date;
    quotaPeriodStart: Date;
    quotaPeriodEnd: Date;
  },
) {
  const contract =
    readParchinServiceSnapshot(input.contractSnapshot) ??
    defaultParchinContractForLevel(input.level, {
      version: 3,
      effectiveFrom: input.activatedAt,
    });
  const enrollment = await tx.parchinEnrollment.upsert({
    where: { cloudInstanceId: input.cloudInstanceId },
    update: {
      subscriptionId: input.subscriptionId ?? undefined,
      level: input.level,
      contractVersion: contract.version,
      contractSnapshot: snapshotParchinServiceContract(contract),
      supportWindow: contract.supportWindow,
      firstResponseTarget: contract.firstResponseTarget,
      routineRequestLimit: contract.operationalPolicy.routineRequestLimit,
      routineRequestsUsed: 0,
      quotaPeriodStart: input.quotaPeriodStart,
      quotaPeriodEnd: input.quotaPeriodEnd,
      requestedNextLevel: null,
      requestedLevelAt: null,
      status: "ACTIVE",
    },
    create: {
      userId: input.userId,
      cloudInstanceId: input.cloudInstanceId,
      serviceOrderId: input.serviceOrderId,
      subscriptionId: input.subscriptionId ?? null,
      level: input.level,
      contractVersion: contract.version,
      contractSnapshot: snapshotParchinServiceContract(contract),
      supportWindow: contract.supportWindow,
      firstResponseTarget: contract.firstResponseTarget,
      routineRequestLimit: contract.operationalPolicy.routineRequestLimit,
      quotaPeriodStart: input.quotaPeriodStart,
      quotaPeriodEnd: input.quotaPeriodEnd,
      activatedAt: input.activatedAt,
    },
  });

  await tx.parchinTask.createMany({
    data: TASK_TEMPLATES.filter(
      (template) => levelRank(input.level) >= levelRank(template.minimumLevel),
    ).map((template) => ({
      enrollmentId: enrollment.id,
      type: template.type,
      templateKey: template.key,
      title: template.title,
      description: template.description,
      priority: template.priority,
      recurrence: template.recurrence,
      dueAt: initialDueAt(input.activatedAt, template.delay),
      idempotencyKey: `parchin-v3:${enrollment.id}:${template.key}:initial`,
    })),
    skipDuplicates: true,
  });
  return enrollment;
}

export async function completeParchinTaskTx(
  tx: Prisma.TransactionClient,
  input: {
    taskId: string;
    adminUserId: string;
    evidenceSummary: string;
    evidence?: Prisma.InputJsonValue;
  },
) {
  const task = await tx.parchinTask.findUnique({ where: { id: input.taskId } });
  if (!task) throw new Error("parchin_task_not_found");
  if (task.status === ParchinTaskStatus.COMPLETED) return task;
  const evidenceSummary = input.evidenceSummary.trim();
  if (evidenceSummary.length < 3 || evidenceSummary.length > 2_000) {
    throw new Error("parchin_evidence_invalid");
  }
  const completedAt = new Date();
  const completed = await tx.parchinTask.update({
    where: { id: task.id },
    data: {
      status: ParchinTaskStatus.COMPLETED,
      completedById: input.adminUserId,
      completedAt,
      evidenceSummary,
      evidence: input.evidence,
      blockedReason: null,
    },
  });
  const nextDue = nextParchinTaskDueAt(task.dueAt, task.recurrence);
  if (nextDue) {
    await tx.parchinTask.upsert({
      where: {
        idempotencyKey: `parchin-v3:${task.enrollmentId}:${task.templateKey}:${nextDue.toISOString()}`,
      },
      update: {},
      create: {
        enrollmentId: task.enrollmentId,
        type: task.type,
        templateKey: task.templateKey,
        title: task.title,
        description: task.description,
        priority: task.priority,
        recurrence: task.recurrence,
        dueAt: nextDue,
        assignedToId: task.assignedToId,
        idempotencyKey: `parchin-v3:${task.enrollmentId}:${task.templateKey}:${nextDue.toISOString()}`,
      },
    });
  }
  return completed;
}

export async function createP1IncidentTaskTx(
  tx: Prisma.TransactionClient,
  input: {
    enrollmentId: string;
    supportRequestId: string;
    dueAt: Date;
    subject: string;
  },
) {
  return tx.parchinTask.upsert({
    where: { idempotencyKey: `parchin-p1:${input.supportRequestId}` },
    update: {},
    create: {
      enrollmentId: input.enrollmentId,
      type: ParchinTaskType.INCIDENT_RESPONSE,
      templateKey: "incident-response",
      title: `رخداد P1: ${input.subject}`,
      description: "رخداد را ارزیابی، مهار و در Timeline عملیاتی ثبت کن.",
      status: ParchinTaskStatus.TODO,
      priority: ParchinTaskPriority.CRITICAL,
      recurrence: ParchinTaskRecurrence.ONCE,
      dueAt: input.dueAt,
      idempotencyKey: `parchin-p1:${input.supportRequestId}`,
      evidence: { supportRequestId: input.supportRequestId },
    },
  });
}

export function readEnrollmentContract(value: unknown): ParchinServiceContract | null {
  return readParchinServiceSnapshot(value);
}
