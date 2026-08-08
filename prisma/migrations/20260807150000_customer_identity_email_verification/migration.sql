-- Additive identity fields for customer registration / email verification.
-- Existing users are marked registration-complete so login is not interrupted.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registrationCompletedAt" TIMESTAMP(3);

-- Historical accounts remain usable without forced registration.
UPDATE "User"
SET "registrationCompletedAt" = COALESCE("registrationCompletedAt", "createdAt")
WHERE "registrationCompletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "EmailVerificationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailVerificationChallenge_userId_email_createdAt_idx"
  ON "EmailVerificationChallenge"("userId", "email", "createdAt");

CREATE INDEX IF NOT EXISTS "EmailVerificationChallenge_expiresAt_idx"
  ON "EmailVerificationChallenge"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EmailVerificationChallenge_userId_fkey'
  ) THEN
    ALTER TABLE "EmailVerificationChallenge"
      ADD CONSTRAINT "EmailVerificationChallenge_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
