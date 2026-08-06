-- CreateEnum
CREATE TYPE "StorefrontAssortmentStyle" AS ENUM ('CHEAPEST', 'STRONGEST');

-- AlterTable
ALTER TABLE "StorefrontAssortmentSettings"
ADD COLUMN "noMinMonthlyPriceRial" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "noMaxMonthlyPriceRial" BIGINT,
ADD COLUMN "ostovarMinMonthlyPriceRial" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "ostovarMaxMonthlyPriceRial" BIGINT,
ADD COLUMN "kahkeshanMinMonthlyPriceRial" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "kahkeshanMaxMonthlyPriceRial" BIGINT,
ADD COLUMN "assortmentStyle" "StorefrontAssortmentStyle" NOT NULL DEFAULT 'CHEAPEST';
