-- Admin-priced Compass service packages (Launch amendment 1.L §13.4).

ALTER TABLE "CommercePricingConfig"
  ADD COLUMN IF NOT EXISTS "compassServicePrices" JSONB NOT NULL DEFAULT '{}';
