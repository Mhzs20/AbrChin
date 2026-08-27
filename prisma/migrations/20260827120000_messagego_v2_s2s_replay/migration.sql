-- Additive PREPROD-01 S2S replay store. Does not alter WP07 wallet tables.

CREATE TABLE "MessageGoS2SReplayNonce" (
    "serviceId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageGoS2SReplayNonce_pkey" PRIMARY KEY ("serviceId","keyId","nonce")
);

CREATE INDEX "MessageGoS2SReplayNonce_expiresAt_idx" ON "MessageGoS2SReplayNonce"("expiresAt");
