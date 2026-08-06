-- AlterTable
ALTER TABLE "StorefrontAssortmentSettings"
ADD COLUMN "showHourlyPrice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showDailyPrice" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showMonthlyPrice" BOOLEAN NOT NULL DEFAULT true;
