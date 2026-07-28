ALTER TABLE "InfrastructurePlan"
ADD COLUMN "vcpu" INTEGER,
ADD COLUMN "ramGb" INTEGER,
ADD COLUMN "storageGb" INTEGER,
ADD COLUMN "renewalPriceRial" BIGINT,
ADD COLUMN "deliveryEstimateMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "parchinIncluded" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ServiceOrder"
ADD COLUMN "quoteExpiresAt" TIMESTAMP(3);
