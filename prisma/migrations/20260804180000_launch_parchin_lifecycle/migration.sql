-- VAT remains 10% (taxBps=1000). Lifecycle reminder/grace days Admin-editable.
ALTER TABLE "CommercePricingConfig" ADD COLUMN "reminderDaysBeforeDue" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "CommercePricingConfig" ADD COLUMN "suspendGraceDaysAfterZero" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "CommercePricingConfig" ADD COLUMN "deleteDaysAfterSuspend" INTEGER NOT NULL DEFAULT 7;

UPDATE "CommercePricingConfig"
SET "taxBps" = 1000
WHERE "id" = 'default';

-- Parchin monthly prices in Rial (تومان × 10).
UPDATE "ParchinPricingConfig"
SET
  "priceRial" = 5000000,
  "active" = true,
  "title" = 'پرچین شروع',
  "description" = 'تحویل کنترل‌شده سرور نو، دسترسی یک‌بارمصرف، پشتیبانی راه‌اندازی در ساعات اداری',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_START';

UPDATE "ParchinPricingConfig"
SET
  "priceRial" = 15000000,
  "active" = true,
  "title" = 'پرچین فعال',
  "description" = 'خدمات شروع + همراهی راه‌اندازی سرویس، بررسی سلامت اولیه، اولویت بالاتر صف تحویل',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_ACTIVE';

UPDATE "ParchinPricingConfig"
SET
  "priceRial" = 50000000,
  "active" = true,
  "title" = 'پرچین پایدار',
  "description" = 'خدمات فعال + هماهنگی مهاجرت سایت/سورس، بازبینی معماری پیشنهادی، مسیر مستقیم پشتیبانی',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "level" = 'PARCHIN_STABLE';
