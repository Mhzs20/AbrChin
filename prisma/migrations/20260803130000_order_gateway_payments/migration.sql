CREATE TYPE "OrderPaymentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'REVIEW',
  'FAILED',
  'CANCELED',
  'EXPIRED'
);

CREATE TABLE "OrderPayment" (
  "id" TEXT NOT NULL,
  "serviceOrderId" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "gateway" "PaymentGatewayProvider" NOT NULL,
  "status" "OrderPaymentStatus" NOT NULL DEFAULT 'CREATED',
  "authority" TEXT,
  "gatewayReference" TEXT,
  "gatewayConfigSnapshot" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "callbackTokenHash" TEXT NOT NULL,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "redirectUrl" TEXT,
  CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderPayment_serviceOrderId_key" ON "OrderPayment"("serviceOrderId");
CREATE UNIQUE INDEX "OrderPayment_authority_key" ON "OrderPayment"("authority");
CREATE UNIQUE INDEX "OrderPayment_gatewayReference_key" ON "OrderPayment"("gatewayReference");
CREATE UNIQUE INDEX "OrderPayment_idempotencyKey_key" ON "OrderPayment"("idempotencyKey");
CREATE INDEX "OrderPayment_status_expiresAt_idx" ON "OrderPayment"("status", "expiresAt");
CREATE INDEX "OrderPayment_callbackTokenHash_idx" ON "OrderPayment"("callbackTokenHash");
CREATE INDEX "OrderPayment_gateway_status_idx" ON "OrderPayment"("gateway", "status");

ALTER TABLE "OrderPayment"
ADD CONSTRAINT "OrderPayment_serviceOrderId_fkey"
FOREIGN KEY ("serviceOrderId") REFERENCES "ServiceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
