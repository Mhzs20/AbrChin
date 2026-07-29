CREATE TYPE "InstanceCredentialStatus" AS ENUM (
  'READY',
  'REVEALED',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE "InstanceCredential" (
  "id" TEXT NOT NULL,
  "cloudInstanceId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "ciphertext" TEXT,
  "iv" TEXT,
  "authTag" TEXT,
  "status" "InstanceCredentialStatus" NOT NULL DEFAULT 'READY',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstanceCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstanceCredential_cloudInstanceId_key"
ON "InstanceCredential"("cloudInstanceId");

CREATE INDEX "InstanceCredential_status_expiresAt_idx"
ON "InstanceCredential"("status", "expiresAt");

CREATE INDEX "InstanceCredential_createdById_createdAt_idx"
ON "InstanceCredential"("createdById", "createdAt");

ALTER TABLE "InstanceCredential"
ADD CONSTRAINT "InstanceCredential_cloudInstanceId_fkey"
FOREIGN KEY ("cloudInstanceId") REFERENCES "CloudInstance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InstanceCredential"
ADD CONSTRAINT "InstanceCredential_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
