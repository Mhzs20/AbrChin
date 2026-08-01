-- Add encrypted, one-time credentials for individually observed inventory.
-- Forward-only and additive: no order, payment, wallet, ledger, paidAt,
-- financial snapshot, provider snapshot or delivered resource is updated.

CREATE TYPE "PreprovisionedInventoryCredentialStatus" AS ENUM (
  'READY', 'TRANSFERRED', 'REVOKED'
);

CREATE TABLE "PreprovisionedInventoryCredential" (
  "id" TEXT NOT NULL,
  "inventoryItemId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "secretFingerprint" TEXT NOT NULL,
  "status" "PreprovisionedInventoryCredentialStatus" NOT NULL DEFAULT 'READY',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "transferredAt" TIMESTAMP(3),
  CONSTRAINT "PreprovisionedInventoryCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PreprovisionedInventoryCredential_username_check"
    CHECK (length(trim("username")) BETWEEN 1 AND 32),
  CONSTRAINT "PreprovisionedInventoryCredential_ciphertext_check"
    CHECK (
      length("ciphertext") > 0 AND
      length("iv") > 0 AND
      length("authTag") > 0 AND
      length("secretFingerprint") = 64
    ),
  CONSTRAINT "PreprovisionedInventoryCredential_inventoryItemId_fkey"
    FOREIGN KEY ("inventoryItemId")
    REFERENCES "PreprovisionedInventoryItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PreprovisionedInventoryCredential_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PreprovisionedInventoryCredential_inventoryItemId_key"
  ON "PreprovisionedInventoryCredential"("inventoryItemId");
CREATE UNIQUE INDEX "PreprovisionedInventoryCredential_secretFingerprint_key"
  ON "PreprovisionedInventoryCredential"("secretFingerprint");
CREATE INDEX "PreprovisionedInventoryCredential_status_createdAt_idx"
  ON "PreprovisionedInventoryCredential"("status", "createdAt");
CREATE INDEX "PreprovisionedInventoryCredential_createdById_createdAt_idx"
  ON "PreprovisionedInventoryCredential"("createdById", "createdAt");
