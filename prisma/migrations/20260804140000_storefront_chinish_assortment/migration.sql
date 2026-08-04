-- CreateEnum
CREATE TYPE "StorefrontChinishTier" AS ENUM ('NO', 'OSTOVAR', 'KAHKESHAN');

-- CreateEnum
CREATE TYPE "StorefrontSlotRole" AS ENUM ('PRIMARY', 'RESERVE');

-- AlterEnum
ALTER TYPE "AdminNotificationType" ADD VALUE 'STOREFRONT_ASSORTMENT_LOW';

-- CreateTable
CREATE TABLE "StorefrontAssortmentSlot" (
    "id" TEXT NOT NULL,
    "tier" "StorefrontChinishTier" NOT NULL,
    "role" "StorefrontSlotRole" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "StorefrontAssortmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorefrontAssortmentSlot_tier_role_sortOrder_idx" ON "StorefrontAssortmentSlot"("tier", "role", "sortOrder");

-- CreateIndex
CREATE INDEX "StorefrontAssortmentSlot_catalogItemId_idx" ON "StorefrontAssortmentSlot"("catalogItemId");

-- CreateIndex
CREATE INDEX "StorefrontAssortmentSlot_updatedById_idx" ON "StorefrontAssortmentSlot"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontAssortmentSlot_tier_catalogItemId_key" ON "StorefrontAssortmentSlot"("tier", "catalogItemId");

-- AddForeignKey
ALTER TABLE "StorefrontAssortmentSlot" ADD CONSTRAINT "StorefrontAssortmentSlot_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "ProviderCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorefrontAssortmentSlot" ADD CONSTRAINT "StorefrontAssortmentSlot_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
