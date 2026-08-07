-- Minimal customer/admin support request flow (additive).
CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "SupportRequestPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "SupportRequestCategory" AS ENUM ('DELIVERY', 'ACCESS', 'BILLING', 'RENEWAL', 'CHANGE', 'OTHER');

CREATE TABLE IF NOT EXISTS "SupportRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cloudInstanceId" TEXT,
    "serviceOrderId" TEXT,
    "category" "SupportRequestCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "parchinLevel" "ParchinLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportRequestMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequestMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportRequest_userId_createdAt_idx" ON "SupportRequest"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportRequest_status_priority_createdAt_idx" ON "SupportRequest"("status", "priority", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportRequest_cloudInstanceId_idx" ON "SupportRequest"("cloudInstanceId");
CREATE INDEX IF NOT EXISTS "SupportRequest_serviceOrderId_idx" ON "SupportRequest"("serviceOrderId");
CREATE INDEX IF NOT EXISTS "SupportRequestMessage_requestId_createdAt_idx" ON "SupportRequestMessage"("requestId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportRequestMessage_authorUserId_idx" ON "SupportRequestMessage"("authorUserId");

ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_cloudInstanceId_fkey" FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_serviceOrderId_fkey" FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportRequestMessage" ADD CONSTRAINT "SupportRequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportRequestMessage" ADD CONSTRAINT "SupportRequestMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
