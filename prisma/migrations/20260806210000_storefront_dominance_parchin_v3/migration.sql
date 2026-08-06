-- Task 2: chinish tiers ignore Disk; formal versioned Parchin service contracts.
-- Forward-only and additive. Prior Quote/Order money snapshots stay untouched.

-- 1) Capacity: Disk is no longer a tier axis. Zero legacy floors so old settings
--    cannot reintroduce Disk into classification after deploy.
ALTER TABLE "StorefrontAssortmentSettings"
  ALTER COLUMN "ostovarMinDiskGb" SET DEFAULT 0;
ALTER TABLE "StorefrontAssortmentSettings"
  ALTER COLUMN "kahkeshanMinDiskGb" SET DEFAULT 0;

UPDATE "StorefrontAssortmentSettings"
SET
  "ostovarMinDiskGb" = 0,
  "kahkeshanMinDiskGb" = 0,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default';

-- 2) Parchin service-contract columns (versioned, snapshot-friendly).
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "subtitle" TEXT;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "includedServices" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "excludedServices" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "serviceLimits" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "supportWindow" TEXT;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "firstResponseTarget" TEXT;
ALTER TABLE "ParchinPricingConfig"
  ADD COLUMN IF NOT EXISTS "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3) Quote / Order immutable Parchin contract snapshots.
ALTER TABLE "RecommendationQuote"
  ADD COLUMN IF NOT EXISTS "parchinServiceSnapshot" JSONB;
ALTER TABLE "ServiceOrder"
  ADD COLUMN IF NOT EXISTS "parchinServiceSnapshot" JSONB;

-- 4) Backfill three Parchin levels with production-grade service contracts.
UPDATE "ParchinPricingConfig"
SET
  "version" = 1,
  "title" = 'پرچین شروع',
  "subtitle" = 'تحویل امن',
  "description" = 'تحویل کنترل‌شده سرور با بررسی دسترسی اولیه و پشتیبانی راه‌اندازی در ساعات اداری.',
  "includedServices" = '["ساخت سرور پس از تأیید ظرفیت","نصب سیستم‌عامل انتخابی","فعال‌شدن IP و تست دسترسی اولیه","تحویل امن و رمزنگاری‌شده اطلاعات ورود","نمایش یک‌بارمصرف رمز یا اتصال SSH Key","نمایش وضعیت سفارش، ساخت، تحویل و تمدید","ثبت رخدادهای حساس تحویل","تحویل فوری در صورت موجودبودن ظرفیت","بررسی اولیه SSH یا RDP","بررسی تطابق سیستم‌عامل و مشخصات سفارش","راهنمای ورود اولیه","یک درخواست پشتیبانی مرتبط با تحویل","پاسخ‌گویی در ساعات اداری"]'::jsonb,
  "excludedServices" = '["نصب نرم‌افزار اختصاصی مشتری","مانیتورینگ مستمر","بکاپ زمان‌بندی‌شده","مهاجرت","مدیریت سیستم‌عامل"]'::jsonb,
  "serviceLimits" = '{"setupScope":"تحویل امن و بررسی اولیه دسترسی","customSoftware":"excluded","continuousMonitoring":"excluded","scheduledBackup":"excluded","migration":"excluded","osManagement":"excluded","patchManagement":"excluded","applicationMaintenance":"excluded"}'::jsonb,
  "supportWindow" = 'ساعات اداری',
  "firstResponseTarget" = 'در ساعات اداری در همان روز کاری',
  "active" = true,
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_START';

UPDATE "ParchinPricingConfig"
SET
  "version" = 1,
  "title" = 'پرچین فعال',
  "subtitle" = 'راه‌اندازی همراه',
  "description" = 'خدمات پرچین شروع به‌همراه یک Setup استاندارد اولیه (Firewall، کاربر امن، Stack انتخابی) و اولویت بالاتر پشتیبانی.',
  "includedServices" = '["ساخت سرور پس از تأیید ظرفیت","نصب سیستم‌عامل انتخابی","فعال‌شدن IP و تست دسترسی اولیه","تحویل امن و رمزنگاری‌شده اطلاعات ورود","نمایش یک‌بارمصرف رمز یا اتصال SSH Key","نمایش وضعیت سفارش، ساخت، تحویل و تمدید","ثبت رخدادهای حساس تحویل","تحویل فوری در صورت موجودبودن ظرفیت","بررسی اولیه SSH یا RDP","بررسی تطابق سیستم‌عامل و مشخصات سفارش","راهنمای ورود اولیه","یک درخواست پشتیبانی مرتبط با تحویل","پاسخ‌گویی در ساعات اداری","به‌روزرسانی اولیه Packageهای سیستم‌عامل","تنظیم اولیه Firewall","تنظیم کاربر مدیریتی و دسترسی امن","تنظیم Timezone و NTP","نصب یک Stack استاندارد انتخابی مانند Docker یا Nginx","بررسی سلامت اولیه پس از راه‌اندازی","اولویت بالاتر در صف پشتیبانی"]'::jsonb,
  "excludedServices" = '["عملیات نامحدود پس از Setup اولیه","مانیتورینگ ۲۴/۷","بکاپ مدیریت‌شده","Patch Management مستمر","نگهداری Application","مهاجرت واقعی (Add-on / قطب‌نما)"]'::jsonb,
  "serviceLimits" = '{"setupScope":"یک Setup استاندارد اولیه، نه عملیات نامحدود","customSoftware":"excluded","continuousMonitoring":"excluded","scheduledBackup":"excluded","migration":"excluded","osManagement":"initial_only","patchManagement":"excluded","applicationMaintenance":"excluded"}'::jsonb,
  "supportWindow" = 'ساعات اداری با اولویت بالاتر',
  "firstResponseTarget" = 'اولویت بالاتر در صف پشتیبانی همان روز کاری',
  "active" = true,
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_ACTIVE';

UPDATE "ParchinPricingConfig"
SET
  "version" = 1,
  "title" = 'پرچین پایدار',
  "subtitle" = 'آماده‌سازی پایداری',
  "description" = 'خدمات پرچین فعال به‌همراه چک‌لیست معماری، پیشنهاد Backup، هماهنگی مهاجرت با قطب‌نما و مسیر مستقیم تمدید و ارتقا.',
  "includedServices" = '["ساخت سرور پس از تأیید ظرفیت","نصب سیستم‌عامل انتخابی","فعال‌شدن IP و تست دسترسی اولیه","تحویل امن و رمزنگاری‌شده اطلاعات ورود","نمایش یک‌بارمصرف رمز یا اتصال SSH Key","نمایش وضعیت سفارش، ساخت، تحویل و تمدید","ثبت رخدادهای حساس تحویل","تحویل فوری در صورت موجودبودن ظرفیت","بررسی اولیه SSH یا RDP","بررسی تطابق سیستم‌عامل و مشخصات سفارش","راهنمای ورود اولیه","یک درخواست پشتیبانی مرتبط با تحویل","پاسخ‌گویی در ساعات اداری","به‌روزرسانی اولیه Packageهای سیستم‌عامل","تنظیم اولیه Firewall","تنظیم کاربر مدیریتی و دسترسی امن","تنظیم Timezone و NTP","نصب یک Stack استاندارد انتخابی مانند Docker یا Nginx","بررسی سلامت اولیه پس از راه‌اندازی","اولویت بالاتر در صف پشتیبانی","چک‌لیست معماری پیش از راه‌اندازی","بررسی شبکه، Firewall و دسترسی‌ها","پیشنهاد Backup و Restore","هماهنگی مهاجرت با قطب‌نما","بررسی نهایی پس از تغییر یا مهاجرت","بالاترین اولویت پشتیبانی","مسیر مستقیم تمدید، ارتقا و تغییر منابع"]'::jsonb,
  "excludedServices" = '["مهاجرت واقعی به‌عنوان خدمت مستقل (قطب‌نما / Add-on)","مانیتورینگ ۲۴/۷","بکاپ مدیریت‌شده زمان‌بندی‌شده","Patch Management مستمر","نگهداری Application"]'::jsonb,
  "serviceLimits" = '{"setupScope":"آماده‌سازی پایداری + هماهنگی قطب‌نما؛ مهاجرت واقعی Add-on است","customSoftware":"excluded","continuousMonitoring":"add_on","scheduledBackup":"add_on","migration":"compass_coordination","osManagement":"initial_only","patchManagement":"add_on","applicationMaintenance":"add_on"}'::jsonb,
  "supportWindow" = 'ساعات اداری با بالاترین اولویت',
  "firstResponseTarget" = 'بالاترین اولویت در صف پشتیبانی',
  "active" = true,
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_STABLE';
