-- Runtime billing safety is forward-only. Existing activation requests retain
-- their historical state; an Approved legacy request without this snapshot is
-- deliberately held for Admin review before any provider mutation.
ALTER TYPE "ProviderBillingContractStatus" ADD VALUE IF NOT EXISTS 'REVOKED';
ALTER TYPE "ProviderBillingContractStatus" ADD VALUE IF NOT EXISTS 'INVALID';

ALTER TABLE "ActivationRequest"
  ADD COLUMN "providerBillingContractSnapshot" JSONB;
