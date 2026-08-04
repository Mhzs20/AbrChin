-- CreateTable
CREATE TABLE "StorefrontAssortmentSettings" (
    "id" TEXT NOT NULL,
    "autoSuggestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastAutoAppliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "StorefrontAssortmentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorefrontAssortmentSettings_updatedById_idx" ON "StorefrontAssortmentSettings"("updatedById");

-- AddForeignKey
ALTER TABLE "StorefrontAssortmentSettings" ADD CONSTRAINT "StorefrontAssortmentSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default settings row
INSERT INTO "StorefrontAssortmentSettings" ("id", "autoSuggestEnabled", "updatedAt")
VALUES ('default', false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
