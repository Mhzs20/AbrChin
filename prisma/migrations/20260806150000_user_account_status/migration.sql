-- CreateEnum
CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "blockedAt" TIMESTAMP(3),
ADD COLUMN "blockedReason" TEXT;
