-- AbrChin-owned MessageGo customer tariffs. MessageGo-supplied wallet
-- amounts are not trusted. Reservations snapshot the tariff used at reserve.

CREATE TABLE "MessageGoCustomerPrice" (
    "stableModelAlias" TEXT NOT NULL,
    "revision" BIGINT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "pricingFingerprint" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "inputRialPerMillion" BIGINT NOT NULL,
    "outputRialPerMillion" BIGINT NOT NULL,
    "maxInputTokens" BIGINT NOT NULL,
    "maxOutputTokens" BIGINT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageGoCustomerPrice_pkey" PRIMARY KEY ("stableModelAlias","revision")
);

CREATE INDEX "MessageGoCustomerPrice_stableModelAlias_effectiveAt_idx"
    ON "MessageGoCustomerPrice"("stableModelAlias", "effectiveAt");

ALTER TABLE "MessageGoCustomerPrice"
    ADD CONSTRAINT "MessageGoCustomerPrice_positive_rates"
    CHECK ("inputRialPerMillion" > 0 AND "outputRialPerMillion" > 0);

ALTER TABLE "MessageGoCustomerPrice"
    ADD CONSTRAINT "MessageGoCustomerPrice_positive_bounds"
    CHECK ("maxInputTokens" > 0 AND "maxOutputTokens" > 0);

ALTER TABLE "MessageGoCustomerPrice"
    ADD CONSTRAINT "MessageGoCustomerPrice_irr"
    CHECK ("currency" = 'IRR');

CREATE OR REPLACE FUNCTION abrchin_reject_messagego_customer_price_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'messagego customer price revisions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS messagego_customer_price_immutable ON "MessageGoCustomerPrice";
CREATE TRIGGER messagego_customer_price_immutable
BEFORE UPDATE OR DELETE ON "MessageGoCustomerPrice"
FOR EACH ROW
EXECUTE FUNCTION abrchin_reject_messagego_customer_price_mutation();

ALTER TABLE "MessageGoAuthorityReservation"
    ADD COLUMN IF NOT EXISTS "modelAlias" TEXT,
    ADD COLUMN IF NOT EXISTS "estimatedMaxInputTokens" BIGINT,
    ADD COLUMN IF NOT EXISTS "requestedMaxOutputTokens" BIGINT,
    ADD COLUMN IF NOT EXISTS "customerInputRialPerMillion" BIGINT,
    ADD COLUMN IF NOT EXISTS "customerOutputRialPerMillion" BIGINT,
    ADD COLUMN IF NOT EXISTS "providerPricingFingerprint" TEXT,
    ADD COLUMN IF NOT EXISTS "providerPricingVersion" TEXT;

CREATE INDEX IF NOT EXISTS "MessageGoAuthorityReservation_modelAlias_idx"
    ON "MessageGoAuthorityReservation"("modelAlias");
