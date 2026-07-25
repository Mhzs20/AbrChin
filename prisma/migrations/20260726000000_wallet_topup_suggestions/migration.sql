-- CreateTable
CREATE TABLE "WalletTopUpSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "suggestedAmountsToman" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "WalletTopUpSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WalletTopUpSettings"
  ADD CONSTRAINT "WalletTopUpSettings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "WalletTopUpSettings" ("id", "suggestedAmountsToman", "updatedAt")
VALUES (
  'default',
  '[1000000,5000000,10000000,20000000]'::jsonb,
  CURRENT_TIMESTAMP
);
