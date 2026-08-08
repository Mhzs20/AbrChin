-- Parchin v2 turns future sales into measurable operational contracts.
-- Existing Quote / Order snapshots remain immutable. Only untouched v1
-- configuration rows are upgraded; Admin-authored v2+ rows are preserved.

UPDATE "ParchinPricingConfig"
SET
  "version" = 2,
  "title" = 'پرچین شروع',
  "subtitle" = 'سلامت پایه هر ماه',
  "description" = 'راه‌اندازی امن، بازبینی ماهانه منابع و یک گزارش روشن برای جلوگیری از غافلگیری.',
  "includedServices" = '["کنترل مشخصات سفارش پیش از ساخت","نصب سیستم‌عامل و فعال‌سازی IP","تحویل امن و رمزنگاری‌شده اطلاعات ورود","پیگیری وضعیت ساخت، تحویل، تمدید و تغییرات در پنل","یادآوری سررسید و ثبت رخدادهای عملیاتی","سخت‌سازی پایه دسترسی و Firewall در شروع","به‌روزرسانی امنیتی سیستم‌عامل هنگام تحویل","بازبینی ماهانه دسترسی و فشار CPU، RAM و Disk","گزارش سلامت ماهانه با اقدام پیشنهادی","یک درخواست عملیاتی روتین در هر ماه","پاسخ اولیه حداکثر تا پایان روز کاری"]'::jsonb,
  "excludedServices" = '["پایش خودکار شبانه‌روزی و مدیریت رخداد","بکاپ مدیریت‌شده و آزمون Restore","نگهداری کد و Application مشتری","مهاجرت سایت یا داده"]'::jsonb,
  "serviceLimits" = '{"setupScope":"راه‌اندازی امن + یک بازبینی و گزارش سلامت در هر ماه","customSoftware":"excluded","continuousMonitoring":"excluded","scheduledBackup":"excluded","migration":"excluded","osManagement":"initial_only","patchManagement":"excluded","applicationMaintenance":"excluded"}'::jsonb,
  "supportWindow" = 'ساعات اداری',
  "firstResponseTarget" = 'حداکثر تا پایان همان روز کاری',
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_START' AND "version" = 1;

UPDATE "ParchinPricingConfig"
SET
  "version" = 2,
  "title" = 'پرچین استوار',
  "subtitle" = 'پایش، بکاپ و نگهداری',
  "description" = 'پایش Uptime، بکاپ روزانه، Patch ماهانه و گزارش عملیاتی برای سرویس‌های در حال رشد.',
  "includedServices" = '["کنترل مشخصات سفارش پیش از ساخت","نصب سیستم‌عامل و فعال‌سازی IP","تحویل امن و رمزنگاری‌شده اطلاعات ورود","پیگیری وضعیت ساخت، تحویل، تمدید و تغییرات در پنل","یادآوری سررسید و ثبت رخدادهای عملیاتی","سخت‌سازی پایه دسترسی و Firewall در شروع","به‌روزرسانی امنیتی سیستم‌عامل هنگام تحویل","بازبینی ماهانه دسترسی و فشار CPU، RAM و Disk","گزارش سلامت ماهانه با اقدام پیشنهادی","یک درخواست عملیاتی روتین در هر ماه","پاسخ اولیه حداکثر تا پایان روز کاری","پایش Uptime پنج‌دقیقه‌ای با رسیدگی هشدار در ساعات کاری","بکاپ روزانه مدیریت‌شده با نگهداری هفت نسخه","بررسی ماهانه امکان بازیابی آخرین بکاپ","اعمال Patch امنیتی سیستم‌عامل در پنجره نگهداری ماهانه","دو درخواست عملیاتی روتین در هر ماه","گزارش ماهانه Uptime، بکاپ، منابع و Patch","پاسخ اولیه حداکثر چهار ساعت کاری"]'::jsonb,
  "excludedServices" = '["رسیدگی انسانی شبانه‌روزی به رخداد","آزمون دوره‌ای Restore در محیط جدا","نگهداری کد و دیتابیس Application","مهاجرت کامل سایت یا سرویس"]'::jsonb,
  "serviceLimits" = '{"setupScope":"پایش، بکاپ، Patch ماهانه و دو اقدام روتین در هر ماه","customSoftware":"excluded","continuousMonitoring":"included","scheduledBackup":"included","migration":"excluded","osManagement":"included","patchManagement":"included","applicationMaintenance":"excluded"}'::jsonb,
  "supportWindow" = 'رسیدگی هشدار در ساعات کاری',
  "firstResponseTarget" = 'حداکثر ۴ ساعت کاری',
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_ACTIVE' AND "version" = 1;

UPDATE "ParchinPricingConfig"
SET
  "version" = 2,
  "title" = 'پرچین کهکشان',
  "subtitle" = 'عملیات Production',
  "description" = 'پایش حیاتی ۲۴/۷، مدیریت رخداد، آزمون Restore و مدیریت تغییر برای سرویس‌های حساس.',
  "includedServices" = '["کنترل مشخصات سفارش پیش از ساخت","نصب سیستم‌عامل و فعال‌سازی IP","تحویل امن و رمزنگاری‌شده اطلاعات ورود","پیگیری وضعیت ساخت، تحویل، تمدید و تغییرات در پنل","یادآوری سررسید و ثبت رخدادهای عملیاتی","سخت‌سازی پایه دسترسی و Firewall در شروع","به‌روزرسانی امنیتی سیستم‌عامل هنگام تحویل","بازبینی ماهانه دسترسی و فشار CPU، RAM و Disk","گزارش سلامت ماهانه با اقدام پیشنهادی","یک درخواست عملیاتی روتین در هر ماه","پاسخ اولیه حداکثر تا پایان روز کاری","پایش Uptime پنج‌دقیقه‌ای با رسیدگی هشدار در ساعات کاری","بکاپ روزانه مدیریت‌شده با نگهداری هفت نسخه","بررسی ماهانه امکان بازیابی آخرین بکاپ","اعمال Patch امنیتی سیستم‌عامل در پنجره نگهداری ماهانه","دو درخواست عملیاتی روتین در هر ماه","گزارش ماهانه Uptime، بکاپ، منابع و Patch","پاسخ اولیه حداکثر چهار ساعت کاری","پایش حیاتی شبانه‌روزی و شروع مدیریت رخدادهای P1","بکاپ روزانه با نگهداری چهارده نسخه","آزمون Restore ماهانه و ثبت نتیجه","بازبینی هفتگی Patch و وضعیت امنیتی سیستم‌عامل","مدیریت تغییرات زیرساخت با برنامه بازگشت","گزارش ظرفیت و پیشنهاد ارتقا پیش از گلوگاه","چهار درخواست عملیاتی روتین در هر ماه","پاسخ رخداد حیاتی حداکثر سی دقیقه"]'::jsonb,
  "excludedServices" = '["توسعه یا رفع باگ کد Application","DBA اختصاصی و بهینه‌سازی Query","مهاجرت کامل سایت یا سرویس بدون سفارش قطب‌نما"]'::jsonb,
  "serviceLimits" = '{"setupScope":"عملیات Production، مدیریت رخداد و چهار اقدام روتین در هر ماه","customSoftware":"excluded","continuousMonitoring":"included","scheduledBackup":"included","migration":"compass_coordination","osManagement":"included","patchManagement":"included","applicationMaintenance":"excluded"}'::jsonb,
  "supportWindow" = 'رخداد حیاتی ۲۴/۷؛ درخواست روتین در ساعات کاری',
  "firstResponseTarget" = 'رخداد حیاتی حداکثر ۳۰ دقیقه',
  "effectiveFrom" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_STABLE' AND "version" = 1;
