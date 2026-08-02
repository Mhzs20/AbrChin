ALTER TABLE "WalletTopUpRefund"
ADD COLUMN "gatewayRefundReference" TEXT,
ADD COLUMN "gatewayRefundedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "WalletTopUpRefund_gatewayRefundReference_key"
ON "WalletTopUpRefund"("gatewayRefundReference");

CREATE UNIQUE INDEX "WalletTopUpRefund_one_approved_per_topup"
ON "WalletTopUpRefund"("walletTopUpId")
WHERE "status" IN (
  'APPROVED'::"ControlledRefundStatus",
  'COMPLETED'::"ControlledRefundStatus"
);
