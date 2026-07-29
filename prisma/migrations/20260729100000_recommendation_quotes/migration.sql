CREATE TYPE "RecommendationFlowStatus" AS ENUM (
  'DISCOVERY',
  'PROFILING',
  'READY_TO_COMPARE',
  'COMPARING',
  'QUOTED',
  'CHECKOUT',
  'CONVERTED',
  'EXPIRED',
  'ESCALATED'
);

CREATE TYPE "RecommendationQuoteRole" AS ENUM (
  'ECONOMY',
  'RECOMMENDED',
  'GROWTH'
);

CREATE TYPE "RecommendationQuoteStatus" AS ENUM (
  'ACTIVE',
  'SELECTED',
  'CONVERTED',
  'EXPIRED',
  'INVALIDATED'
);

ALTER TABLE "ServiceOrder"
ADD COLUMN "recommendationQuoteId" TEXT;

CREATE TABLE "RecommendationSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "status" "RecommendationFlowStatus" NOT NULL DEFAULT 'DISCOVERY',
  "answers" JSONB NOT NULL,
  "answerSources" JSONB NOT NULL,
  "profile" JSONB,
  "confidence" TEXT,
  "architectureEscalation" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecommendationSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecommendationQuote" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "role" "RecommendationQuoteRole" NOT NULL,
  "status" "RecommendationQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "score" DOUBLE PRECISION NOT NULL,
  "scoreBreakdown" JSONB NOT NULL,
  "reasons" JSONB NOT NULL,
  "profileSnapshot" JSONB NOT NULL,
  "planSnapshot" JSONB NOT NULL,
  "amountRial" BIGINT NOT NULL,
  "renewalAmountRial" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "selectedAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecommendationQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceOrder_recommendationQuoteId_key"
ON "ServiceOrder"("recommendationQuoteId");

CREATE INDEX "RecommendationSession_userId_createdAt_idx"
ON "RecommendationSession"("userId", "createdAt");

CREATE INDEX "RecommendationSession_status_expiresAt_idx"
ON "RecommendationSession"("status", "expiresAt");

CREATE UNIQUE INDEX "RecommendationQuote_sessionId_role_key"
ON "RecommendationQuote"("sessionId", "role");

CREATE INDEX "RecommendationQuote_sessionId_status_idx"
ON "RecommendationQuote"("sessionId", "status");

CREATE INDEX "RecommendationQuote_planId_expiresAt_idx"
ON "RecommendationQuote"("planId", "expiresAt");

CREATE INDEX "RecommendationQuote_status_expiresAt_idx"
ON "RecommendationQuote"("status", "expiresAt");

ALTER TABLE "RecommendationSession"
ADD CONSTRAINT "RecommendationSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecommendationQuote"
ADD CONSTRAINT "RecommendationQuote_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "RecommendationSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecommendationQuote"
ADD CONSTRAINT "RecommendationQuote_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "InfrastructurePlan"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ServiceOrder"
ADD CONSTRAINT "ServiceOrder_recommendationQuoteId_fkey"
FOREIGN KEY ("recommendationQuoteId") REFERENCES "RecommendationQuote"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
