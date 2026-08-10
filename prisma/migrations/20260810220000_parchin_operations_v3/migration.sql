CREATE TYPE "ParchinEnrollmentStatus" AS ENUM (
  'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'ENDED'
);

CREATE TYPE "ParchinTaskType" AS ENUM (
  'INITIAL_HARDENING', 'INITIAL_SECURITY_UPDATE', 'RESOURCE_REVIEW',
  'HEALTH_REPORT', 'UPTIME_MONITORING', 'DAILY_BACKUP',
  'BACKUP_RESTORE_CHECK', 'SECURITY_PATCH', 'OPERATIONS_REPORT',
  'CRITICAL_MONITORING', 'RESTORE_TEST', 'SECURITY_REVIEW',
  'CHANGE_MANAGEMENT', 'CAPACITY_REPORT', 'INCIDENT_RESPONSE'
);

CREATE TYPE "ParchinTaskStatus" AS ENUM (
  'TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELED'
);

CREATE TYPE "ParchinTaskPriority" AS ENUM ('NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "ParchinTaskRecurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "ParchinReportType" AS ENUM (
  'HEALTH', 'OPERATIONS', 'RESTORE', 'SECURITY', 'CAPACITY', 'INCIDENT'
);
CREATE TYPE "ParchinReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "SupportRequestKind" AS ENUM ('GENERAL', 'ROUTINE', 'P1_INCIDENT');

CREATE TABLE "ParchinEnrollment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cloudInstanceId" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "level" "ParchinLevel" NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "contractSnapshot" JSONB NOT NULL,
  "status" "ParchinEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "supportWindow" TEXT NOT NULL,
  "firstResponseTarget" TEXT NOT NULL,
  "routineRequestLimit" INTEGER NOT NULL,
  "routineRequestsUsed" INTEGER NOT NULL DEFAULT 0,
  "quotaPeriodStart" TIMESTAMP(3) NOT NULL,
  "quotaPeriodEnd" TIMESTAMP(3) NOT NULL,
  "requestedNextLevel" "ParchinLevel",
  "requestedLevelAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParchinEnrollment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParchinEnrollment_contract_version_check" CHECK ("contractVersion" > 0),
  CONSTRAINT "ParchinEnrollment_routine_limit_check" CHECK ("routineRequestLimit" >= 0),
  CONSTRAINT "ParchinEnrollment_routine_used_check" CHECK ("routineRequestsUsed" >= 0),
  CONSTRAINT "ParchinEnrollment_quota_period_check" CHECK ("quotaPeriodEnd" > "quotaPeriodStart")
);

CREATE UNIQUE INDEX "ParchinEnrollment_cloudInstanceId_key" ON "ParchinEnrollment"("cloudInstanceId");
CREATE UNIQUE INDEX "ParchinEnrollment_serviceOrderId_key" ON "ParchinEnrollment"("serviceOrderId");
CREATE UNIQUE INDEX "ParchinEnrollment_subscriptionId_key" ON "ParchinEnrollment"("subscriptionId");
CREATE INDEX "ParchinEnrollment_status_level_idx" ON "ParchinEnrollment"("status", "level");
CREATE INDEX "ParchinEnrollment_userId_status_idx" ON "ParchinEnrollment"("userId", "status");
CREATE INDEX "ParchinEnrollment_quotaPeriodEnd_idx" ON "ParchinEnrollment"("quotaPeriodEnd");

CREATE TABLE "ParchinTask" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "type" "ParchinTaskType" NOT NULL,
  "templateKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ParchinTaskStatus" NOT NULL DEFAULT 'TODO',
  "priority" "ParchinTaskPriority" NOT NULL DEFAULT 'NORMAL',
  "recurrence" "ParchinTaskRecurrence" NOT NULL DEFAULT 'ONCE',
  "dueAt" TIMESTAMP(3) NOT NULL,
  "assignedToId" TEXT,
  "completedById" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "evidenceSummary" TEXT,
  "evidence" JSONB,
  "blockedReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParchinTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParchinTask_idempotencyKey_key" ON "ParchinTask"("idempotencyKey");
CREATE INDEX "ParchinTask_status_dueAt_idx" ON "ParchinTask"("status", "dueAt");
CREATE INDEX "ParchinTask_enrollmentId_status_dueAt_idx" ON "ParchinTask"("enrollmentId", "status", "dueAt");
CREATE INDEX "ParchinTask_assignedToId_status_dueAt_idx" ON "ParchinTask"("assignedToId", "status", "dueAt");
CREATE INDEX "ParchinTask_priority_status_dueAt_idx" ON "ParchinTask"("priority", "status", "dueAt");

CREATE TABLE "ParchinReport" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "type" "ParchinReportType" NOT NULL,
  "status" "ParchinReportStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "recommendations" JSONB NOT NULL DEFAULT '[]',
  "createdById" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParchinReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParchinReport_period_check" CHECK ("periodEnd" >= "periodStart")
);

CREATE INDEX "ParchinReport_enrollmentId_status_periodEnd_idx" ON "ParchinReport"("enrollmentId", "status", "periodEnd");
CREATE INDEX "ParchinReport_status_publishedAt_idx" ON "ParchinReport"("status", "publishedAt");

ALTER TABLE "SupportRequest"
  ADD COLUMN "parchinEnrollmentId" TEXT,
  ADD COLUMN "kind" "SupportRequestKind" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "assignedToId" TEXT,
  ADD COLUMN "firstResponseDueAt" TIMESTAMP(3),
  ADD COLUMN "firstRespondedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "routineQuotaConsumed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "p1DeclaredAt" TIMESTAMP(3);

CREATE INDEX "SupportRequest_parchinEnrollmentId_kind_createdAt_idx" ON "SupportRequest"("parchinEnrollmentId", "kind", "createdAt");
CREATE INDEX "SupportRequest_assignedToId_status_firstResponseDueAt_idx" ON "SupportRequest"("assignedToId", "status", "firstResponseDueAt");
CREATE INDEX "SupportRequest_status_firstResponseDueAt_idx" ON "SupportRequest"("status", "firstResponseDueAt");

ALTER TABLE "ParchinEnrollment" ADD CONSTRAINT "ParchinEnrollment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParchinEnrollment" ADD CONSTRAINT "ParchinEnrollment_cloudInstanceId_fkey"
  FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParchinEnrollment" ADD CONSTRAINT "ParchinEnrollment_serviceOrderId_fkey"
  FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ParchinEnrollment" ADD CONSTRAINT "ParchinEnrollment_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "ServiceSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParchinTask" ADD CONSTRAINT "ParchinTask_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "ParchinEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParchinTask" ADD CONSTRAINT "ParchinTask_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParchinTask" ADD CONSTRAINT "ParchinTask_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParchinReport" ADD CONSTRAINT "ParchinReport_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "ParchinEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParchinReport" ADD CONSTRAINT "ParchinReport_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_parchinEnrollmentId_fkey"
  FOREIGN KEY ("parchinEnrollmentId") REFERENCES "ParchinEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "ParchinPricingConfig"
SET
  "version" = 3,
  "title" = CASE "level"
    WHEN 'PARCHIN_START' THEN 'پرچین شروع'
    WHEN 'PARCHIN_ACTIVE' THEN 'پرچین استوار'
    ELSE 'پرچین کهکشان'
  END,
  "subtitle" = CASE "level"
    WHEN 'PARCHIN_START' THEN 'سلامت پایه هر ماه'
    WHEN 'PARCHIN_ACTIVE' THEN 'پایش، بکاپ و نگهداری'
    ELSE 'عملیات Production و رخداد حیاتی'
  END,
  "description" = CASE "level"
    WHEN 'PARCHIN_START' THEN 'راه‌اندازی امن، بازبینی ماهانه منابع و یک گزارش روشن برای جلوگیری از غافلگیری.'
    WHEN 'PARCHIN_ACTIVE' THEN 'پایش پنج‌دقیقه‌ای، بکاپ روزانه، Patch ماهانه و گزارش عملیاتی برای سرویس‌های در حال رشد.'
    ELSE 'پایش حیاتی ۲۴/۷، مدیریت رخداد P1، آزمون Restore و مدیریت تغییر برای سرویس‌های حساس.'
  END,
  "supportWindow" = CASE "level"
    WHEN 'PARCHIN_START' THEN 'شنبه تا چهارشنبه ۹ تا ۱۸ و پنج‌شنبه ۹ تا ۱۴ به وقت تهران'
    WHEN 'PARCHIN_ACTIVE' THEN 'رسیدگی در ساعات کاری؛ پایش خودکار پیوسته'
    ELSE 'رخداد حیاتی P1 به‌صورت ۲۴/۷؛ درخواست روتین در ساعات کاری'
  END,
  "firstResponseTarget" = CASE "level"
    WHEN 'PARCHIN_START' THEN 'حداکثر تا پایان همان روز کاری'
    WHEN 'PARCHIN_ACTIVE' THEN 'حداکثر ۴ ساعت کاری'
    ELSE 'رخداد P1 حداکثر ۳۰ دقیقه؛ سایر درخواست‌ها حداکثر ۴ ساعت کاری'
  END,
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "version" < 3;

INSERT INTO "ParchinEnrollment" (
  "id", "userId", "cloudInstanceId", "serviceOrderId", "subscriptionId",
  "level", "contractVersion", "contractSnapshot", "status",
  "supportWindow", "firstResponseTarget", "routineRequestLimit",
  "quotaPeriodStart", "quotaPeriodEnd", "activatedAt", "createdAt", "updatedAt"
)
SELECT
  'pe-' || md5(ci."id"),
  ci."userId",
  ci."id",
  so."id",
  ss."id",
  so."parchinLevel",
  CASE
    WHEN COALESCE(so."parchinServiceSnapshot"->>'version', '') ~ '^[1-9][0-9]*$'
      THEN (so."parchinServiceSnapshot"->>'version')::integer
    ELSE 3
  END,
  COALESCE(
    so."parchinServiceSnapshot",
    jsonb_build_object(
      'level', so."parchinLevel",
      'version', 3,
      'title', CASE so."parchinLevel"
        WHEN 'PARCHIN_START' THEN 'پرچین شروع'
        WHEN 'PARCHIN_ACTIVE' THEN 'پرچین استوار'
        ELSE 'پرچین کهکشان'
      END
    )
  ),
  CASE ss."status"
    WHEN 'PAST_DUE' THEN 'PAST_DUE'::"ParchinEnrollmentStatus"
    WHEN 'SUSPENDED' THEN 'SUSPENDED'::"ParchinEnrollmentStatus"
    WHEN 'CANCELED' THEN 'CANCELED'::"ParchinEnrollmentStatus"
    WHEN 'TERMINATED' THEN 'ENDED'::"ParchinEnrollmentStatus"
    ELSE 'ACTIVE'::"ParchinEnrollmentStatus"
  END,
  CASE so."parchinLevel"
    WHEN 'PARCHIN_START' THEN 'شنبه تا چهارشنبه ۹ تا ۱۸ و پنج‌شنبه ۹ تا ۱۴ به وقت تهران'
    WHEN 'PARCHIN_ACTIVE' THEN 'رسیدگی در ساعات کاری؛ پایش خودکار پیوسته'
    ELSE 'رخداد حیاتی P1 به‌صورت ۲۴/۷؛ درخواست روتین در ساعات کاری'
  END,
  CASE so."parchinLevel"
    WHEN 'PARCHIN_START' THEN 'حداکثر تا پایان همان روز کاری'
    WHEN 'PARCHIN_ACTIVE' THEN 'حداکثر ۴ ساعت کاری'
    ELSE 'رخداد P1 حداکثر ۳۰ دقیقه؛ سایر درخواست‌ها حداکثر ۴ ساعت کاری'
  END,
  CASE so."parchinLevel" WHEN 'PARCHIN_START' THEN 1 WHEN 'PARCHIN_ACTIVE' THEN 2 ELSE 4 END,
  COALESCE(ss."currentPeriodStart", ci."deliveredAt", CURRENT_TIMESTAMP),
  COALESCE(ss."currentPeriodEnd", COALESCE(ci."deliveredAt", CURRENT_TIMESTAMP) + INTERVAL '1 month'),
  COALESCE(ci."deliveredAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "CloudInstance" ci
JOIN "InfrastructureOrder" io ON io."id" = ci."infrastructureOrderId"
JOIN "ServiceOrder" so ON so."id" = io."serviceOrderId"
LEFT JOIN "ServiceSubscription" ss ON ss."cloudInstanceId" = ci."id"
WHERE ci."status" = 'ACTIVE'
  AND so."parchinLevel" IS NOT NULL
ON CONFLICT ("cloudInstanceId") DO NOTHING;

INSERT INTO "ParchinTask" (
  "id", "enrollmentId", "type", "templateKey", "title", "description",
  "priority", "recurrence", "dueAt", "idempotencyKey", "createdAt", "updatedAt"
)
SELECT
  'pt-' || md5(pe."id" || t.key),
  pe."id",
  t.type::"ParchinTaskType",
  t.key,
  t.title,
  t.description,
  t.priority::"ParchinTaskPriority",
  t.recurrence::"ParchinTaskRecurrence",
  pe."activatedAt" + t.delay,
  'parchin-v3:' || pe."id" || ':' || t.key || ':initial',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ParchinEnrollment" pe
CROSS JOIN LATERAL (
  VALUES
    ('initial-hardening', 'INITIAL_HARDENING', 'سخت‌سازی اولیه سرور', 'Firewall، دسترسی و تنظیمات پایه را طبق چک‌لیست ثبت کن.', 'HIGH', 'ONCE', INTERVAL '0 minutes', 1),
    ('initial-security-update', 'INITIAL_SECURITY_UPDATE', 'به‌روزرسانی امنیتی هنگام تحویل', 'خروجی به‌روزرسانی امنیتی سیستم‌عامل را ثبت کن.', 'HIGH', 'ONCE', INTERVAL '0 minutes', 1),
    ('resource-review', 'RESOURCE_REVIEW', 'بازبینی ماهانه منابع', 'CPU، RAM، Disk و دسترسی‌ها را بازبینی و نتیجه را ثبت کن.', 'NORMAL', 'MONTHLY', INTERVAL '1 month', 1),
    ('health-report', 'HEALTH_REPORT', 'گزارش سلامت ماهانه', 'گزارش سلامت و اقدام پیشنهادی مشتری را آماده کن.', 'NORMAL', 'MONTHLY', INTERVAL '1 month', 1),
    ('uptime-monitoring', 'UPTIME_MONITORING', 'کنترل پوشش پایش پنج‌دقیقه‌ای', 'پایش، هشدار و مسیر رسیدگی را کنترل و ثبت کن.', 'HIGH', 'DAILY', INTERVAL '1 day', 2),
    ('daily-backup', 'DAILY_BACKUP', 'کنترل بکاپ روزانه', 'موفقیت بکاپ، نگهداری نسخه‌ها و هشدار شکست را ثبت کن.', 'HIGH', 'DAILY', INTERVAL '1 day', 2),
    ('backup-restore-check', 'BACKUP_RESTORE_CHECK', 'بررسی ماهانه قابلیت بازیابی', 'خوانایی و قابلیت استفاده آخرین بکاپ را بررسی کن.', 'HIGH', 'MONTHLY', INTERVAL '1 month', 2),
    ('security-patch', 'SECURITY_PATCH', 'Patch امنیتی ماهانه', 'تغییرات، نتیجه و برنامه بازگشت Patch را ثبت کن.', 'HIGH', 'MONTHLY', INTERVAL '1 month', 2),
    ('operations-report', 'OPERATIONS_REPORT', 'گزارش عملیات ماهانه', 'Uptime، بکاپ، منابع و Patch را برای مشتری منتشر کن.', 'HIGH', 'MONTHLY', INTERVAL '1 month', 2),
    ('critical-monitoring', 'CRITICAL_MONITORING', 'کنترل پایش حیاتی ۲۴/۷', 'پوشش On-call و مسیر رخداد P1 را کنترل کن.', 'CRITICAL', 'DAILY', INTERVAL '1 day', 3),
    ('restore-test', 'RESTORE_TEST', 'آزمون Restore ماهانه', 'Restore واقعی را در محیط ایزوله اجرا و نتیجه را ثبت کن.', 'CRITICAL', 'MONTHLY', INTERVAL '1 month', 3),
    ('security-review', 'SECURITY_REVIEW', 'بازبینی امنیتی هفتگی', 'Patch، دسترسی و هشدارهای امنیتی را مرور کن.', 'CRITICAL', 'WEEKLY', INTERVAL '7 days', 3),
    ('capacity-report', 'CAPACITY_REPORT', 'گزارش ظرفیت ماهانه', 'روند منابع و ریسک گلوگاه را همراه پیشنهاد ثبت کن.', 'HIGH', 'MONTHLY', INTERVAL '1 month', 3)
) AS t(key, type, title, description, priority, recurrence, delay, min_rank)
WHERE CASE pe."level" WHEN 'PARCHIN_START' THEN 1 WHEN 'PARCHIN_ACTIVE' THEN 2 ELSE 3 END >= t.min_rank
ON CONFLICT ("idempotencyKey") DO NOTHING;
