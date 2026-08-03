-- Provider billing terms are evidence-backed and versioned independently from
-- AbrChin display/settlement policy. Existing service and financial records are
-- intentionally not rewritten.
CREATE TYPE "ProviderBillingContractStatus" AS ENUM ('VERIFIED', 'UNVERIFIED');

CREATE TABLE "ProviderBillingContractVersion" (
    "id" TEXT NOT NULL,
    "provider" "InfrastructureProvider" NOT NULL,
    "providerApiVersion" TEXT NOT NULL,
    "productKind" "InfrastructureProductKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProviderBillingContractStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "calculationUnit" "BillingCalculationUnit",
    "minimumChargeSeconds" INTEGER,
    "roundingPolicy" "BillingRoundingPolicy",
    "prorationSupported" BOOLEAN,
    "hourlyRateAvailable" BOOLEAN,
    "dailyRateAvailable" BOOLEAN,
    "stopStateBillableComponents" JSONB NOT NULL,
    "fieldVerification" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderBillingContractVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderBillingContractVersion_provider_providerApiVersion_productKind_version_key"
  ON "ProviderBillingContractVersion"("provider", "providerApiVersion", "productKind", "version");
CREATE INDEX "ProviderBillingContractVersion_provider_providerApiVersion_productKind_effectiveFrom_idx"
  ON "ProviderBillingContractVersion"("provider", "providerApiVersion", "productKind", "effectiveFrom");

-- Arvan and ParsPack currently have no verified PAYG billing evidence. These
-- rows are deliberately incomplete and must not be treated as a billable
-- provider contract.
INSERT INTO "ProviderBillingContractVersion" (
  "id", "provider", "providerApiVersion", "productKind", "version", "status", "source",
  "calculationUnit", "minimumChargeSeconds", "roundingPolicy", "prorationSupported",
  "hourlyRateAvailable", "dailyRateAvailable", "stopStateBillableComponents",
  "fieldVerification", "effectiveFrom"
) VALUES
  (
    'provider-billing-contract:arvan:v1:1', 'ARVAN', 'v1', 'CLOUD_SERVER', 1, 'UNVERIFIED',
    'adapter_contract_not_verified', NULL, NULL, NULL, NULL, NULL, NULL,
    '{"compute":"UNVERIFIED","disk":"UNVERIFIED","ip":"UNVERIFIED","backup":"UNVERIFIED","traffic":"UNVERIFIED","snapshot":"UNVERIFIED"}'::jsonb,
    '{"calculationUnit":"UNVERIFIED","minimumChargeSeconds":"UNVERIFIED","roundingPolicy":"UNVERIFIED","prorationSupported":"UNVERIFIED","hourlyRateAvailable":"UNVERIFIED","dailyRateAvailable":"UNVERIFIED","stopStateBillableComponents":"UNVERIFIED"}'::jsonb,
    CURRENT_TIMESTAMP
  ),
  (
    'provider-billing-contract:parspack:v1:1', 'PARSPACK', 'v1', 'CLOUD_SERVER', 1, 'UNVERIFIED',
    'adapter_contract_not_verified', NULL, NULL, NULL, NULL, NULL, NULL,
    '{"compute":"UNVERIFIED","disk":"UNVERIFIED","ip":"UNVERIFIED","backup":"UNVERIFIED","traffic":"UNVERIFIED","snapshot":"UNVERIFIED"}'::jsonb,
    '{"calculationUnit":"UNVERIFIED","minimumChargeSeconds":"UNVERIFIED","roundingPolicy":"UNVERIFIED","prorationSupported":"UNVERIFIED","hourlyRateAvailable":"UNVERIFIED","dailyRateAvailable":"UNVERIFIED","stopStateBillableComponents":"UNVERIFIED"}'::jsonb,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("provider", "providerApiVersion", "productKind", "version") DO NOTHING;

ALTER TABLE "RateCardVersion"
  ADD COLUMN "providerBillingContractSnapshot" JSONB;
