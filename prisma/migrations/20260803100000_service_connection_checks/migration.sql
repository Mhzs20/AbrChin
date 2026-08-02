CREATE TYPE "ServiceConnectionName" AS ENUM ('ARVAN', 'PARSPACK', 'KAVENEGAR', 'PAYMENT_GATEWAY');

CREATE TYPE "ServiceConnectionCheckStatus" AS ENUM ('HEALTHY', 'UNCONFIGURED', 'UNVERIFIED', 'ERROR');

CREATE TABLE "ServiceConnectionCheck" (
    "service" "ServiceConnectionName" NOT NULL,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "status" "ServiceConnectionCheckStatus" NOT NULL DEFAULT 'UNCONFIGURED',
    "capabilities" JSONB NOT NULL,
    "errorCode" TEXT,
    "message" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConnectionCheck_pkey" PRIMARY KEY ("service")
);
