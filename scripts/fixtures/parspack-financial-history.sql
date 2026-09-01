-- Realistic ParsPack commercial history for upgrade tests.
-- Applied only on schemas that still have InfrastructureProvider.PARSPACK.
-- Amounts are integer rial. Does not contain secrets.

INSERT INTO "User" (
  id, mobile, "displayName", role, "accountStatus", "mobileVerifiedAt", "updatedAt"
) VALUES (
  'parspack-hist-user', '09121110001', 'ParsPack History', 'CUSTOMER',
  'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "User" (
  id, mobile, "displayName", role, "accountStatus", "mobileVerifiedAt", "updatedAt"
) VALUES (
  'parspack-hist-admin', '09121110002', 'ParsPack Admin', 'ADMIN',
  'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "Wallet" (
  id, "userId", "availableBalance", status, "updatedAt"
) VALUES (
  'parspack-hist-wallet', 'parspack-hist-user', 2500000, 'ACTIVE', CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "ProviderCatalogItem" (
  id, provider, "regionCode", "sizeCode", "sizeName",
  "compatibleImageCodes", vcpu, "ramMb", "diskGb", available, active,
  "priceMonthlyAmount", "currencyCode", "amountUnit", "lastSyncedAt",
  "updatedAt", "apiVersion", "productKind", "externalPlanId",
  "externalKey", status, "providerMonthlyPriceIrr", "lastSeenAt",
  "rawPayload", "payloadHash", "catalogVersion"
) VALUES (
  'parspack-hist-catalog', 'PARSPACK', 'tehran', 'g1-2', 'G1-2',
  '["ubuntu"]', 2, 2048, 40, true, true,
  8000000, 'IRR', 'RIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  'v1', 'READY_INSTANT_SERVER', 'g1-2',
  'parspack:v1:tehran:g1-2', 'ACTIVE', 8000000,
  CURRENT_TIMESTAMP, '{"source":"parspack-history-fixture"}'::jsonb, 'parspack-hist-payload', 'parspack-hist-v1'
);

INSERT INTO "InfrastructurePlan" (
  id, code, title, provider, "regionCode", "sizeCode", "imageCode",
  "deliveryMode", "salePriceRial", "estimatedProviderCostRial",
  active, "updatedAt", vcpu, "ramGb", "storageGb",
  "renewalPriceRial", "parchinIncluded", "catalogItemId",
  "catalogMappingStatus", "providerApiVersion", "productKind",
  "minimumParchinLevel"
) VALUES (
  'parspack-hist-plan', 'PARSPACK_HIST_G1', 'ParsPack History G1', 'PARSPACK',
  'tehran', 'g1-2', 'ubuntu', 'MANAGED', 10000000, 8000000,
  true, CURRENT_TIMESTAMP, 2, 2, 40, 10000000, true,
  'parspack-hist-catalog', 'MAPPED', 'v1', 'READY_INSTANT_SERVER',
  'PARCHIN_START'
);

INSERT INTO "RecommendationSession" (
  id, "userId", status, answers, "answerSources", "productFlowState",
  "expiresAt", "createdAt", "updatedAt"
) VALUES (
  'parspack-hist-session', 'parspack-hist-user', 'CONVERTED', '{}'::jsonb, '{}'::jsonb, 'CONVERTED',
  CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "RecommendationQuote" (
  id, "sessionId", "planId", role, status, score, "scoreBreakdown",
  reasons, "profileSnapshot", "planSnapshot", "amountRial",
  "renewalAmountRial", "catalogItemId",
  "providerBasePriceRialSnapshot", "markupBasisPointsSnapshot",
  "finalPriceRialSnapshot", "currencySnapshot",
  "providerPriceCheckedAt", provider, "providerApiVersion",
  "productKind", "providerRegion", "externalPlanId", "externalImageId",
  "externalNetworkId", "externalSecurityId", "vcpuSnapshot",
  "ramMbSnapshot", "diskGbSnapshot", "operatingSystemSnapshot",
  "providerMonthlyPriceIrr", "markupAmountIrr", "parchinLevel",
  "parchinPriceIrr", "providerAddonsSnapshot", "taxBasisPointsSnapshot",
  "taxAmountIrr", "lineItemsSnapshot", "quotedAt", "catalogVersion",
  "providerPayloadHash", "expiresAt", "updatedAt"
) VALUES (
  'parspack-hist-quote', 'parspack-hist-session', 'parspack-hist-plan', 'RECOMMENDED',
  'CONVERTED', 100, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
  12500000, 10000000, 'parspack-hist-catalog', 8000000, 2500,
  12500000, 'IRR', CURRENT_TIMESTAMP, 'PARSPACK', 'v1',
  'READY_INSTANT_SERVER', 'tehran', 'g1-2', 'ubuntu',
  'provider-default', 'provider-default', 2, 2048, 40, 'Ubuntu',
  8000000, 2000000, 'PARCHIN_START', 0, '[]'::jsonb, 0, 0, '[]'::jsonb,
  CURRENT_TIMESTAMP, 'parspack-hist-v1', 'parspack-hist-payload',
  CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
);

INSERT INTO "ServiceOrder" (
  id, "userId", title, amount, currency, status, "planId",
  "recommendationQuoteId", provider, "providerApiVersion", "productKind",
  "parchinLevel", "productFlowState", "paidAt", "updatedAt"
) VALUES (
  'parspack-hist-order', 'parspack-hist-user', 'ParsPack History Order',
  12500000, 'IRR', 'PAID', 'parspack-hist-plan',
  'parspack-hist-quote', 'PARSPACK', 'v1', 'READY_INSTANT_SERVER',
  'PARCHIN_START', 'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "InfrastructureOrder" (
  id, "serviceOrderId", "userId", "planId", provider, "providerApiVersion",
  "productKind", "parchinLevel", "deliveryMode", status, "requiredFundingRial",
  "productFlowState", "updatedAt"
) VALUES (
  'parspack-hist-infra', 'parspack-hist-order', 'parspack-hist-user',
  'parspack-hist-plan', 'PARSPACK', 'v1', 'READY_INSTANT_SERVER',
  'PARCHIN_START', 'MANAGED', 'FAILED', 8000000,
  'PROVISIONING_MANUAL_REVIEW', CURRENT_TIMESTAMP
);

INSERT INTO "CloudInstance" (
  id, "infrastructureOrderId", "userId", provider, "providerInstanceId",
  name, region, size, image, "deliveryMode", status, "updatedAt"
) VALUES (
  'parspack-hist-instance', 'parspack-hist-infra', 'parspack-hist-user',
  'PARSPACK', 'pp-hist-1', 'parspack-history-1', 'tehran', 'g1-2', 'ubuntu',
  'MANAGED', 'FAILED', CURRENT_TIMESTAMP
);

INSERT INTO "ServiceSubscription" (
  id, "cloudInstanceId", "sourceOrderId", "userId", "planId", status,
  "parchinLevel", "renewalPriceRial", "currentPeriodStart", "currentPeriodEnd",
  "nextRenewalAt", "graceEndsAt", "termMonths", "updatedAt"
) VALUES (
  'parspack-hist-sub', 'parspack-hist-instance', 'parspack-hist-order',
  'parspack-hist-user', 'parspack-hist-plan', 'ACTIVE',
  'PARCHIN_START', 10000000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days',
  CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP + INTERVAL '33 days',
  1, CURRENT_TIMESTAMP
);

INSERT INTO "ResourceVersion" (
  id, "cloudInstanceId", "planId", provider, "providerInstanceId", state,
  vcpu, "ramMb", "diskGb", "resourceSnapshot", "providerConfirmedAt",
  "effectiveFrom", "idempotencyKey"
) VALUES (
  'parspack-hist-rv', 'parspack-hist-instance', 'parspack-hist-plan',
  'PARSPACK', 'pp-hist-1', 'ACTIVE',
  2, 2048, 40, '{"fixture":true}'::jsonb, CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP, 'parspack-hist-rv-1'
);

INSERT INTO "BillingReconciliation" (
  id, provider, kind, status, "cloudInstanceId", "internalAmountRial",
  "providerAmount", "providerCurrency", "providerAmountUnit",
  "normalizedProviderRial", "differenceRial", "idempotencyKey"
) VALUES (
  'parspack-hist-recon', 'PARSPACK', 'PROVIDER_INVOICE', 'MATCHED',
  'parspack-hist-instance', 8000000, 8000000, 'IRR', 'RIAL', 8000000, 0,
  'parspack-hist-recon-1'
);

INSERT INTO "WalletLedgerEntry" (
  id, "walletId", direction, type, amount, status, "referenceType",
  "referenceId", "idempotencyKey", "balanceAfter", description
) VALUES
  (
    'parspack-hist-ledger-topup', 'parspack-hist-wallet', 'CREDIT', 'TOP_UP',
    15000000, 'COMPLETED', 'topup', 'parspack-hist-topup',
    'parspack-hist-topup-1', 15000000, 'ParsPack-era wallet top-up'
  ),
  (
    'parspack-hist-ledger-debit', 'parspack-hist-wallet', 'DEBIT', 'SERVICE_PURCHASE',
    12500000, 'COMPLETED', 'order', 'parspack-hist-order',
    'order_pay_parspack-hist-order', 2500000, 'ParsPack history order debit'
  );

INSERT INTO "AuditLog" (
  id, "actorUserId", action, "entityType", "entityId", "afterData",
  "idempotencyKey"
) VALUES (
  'parspack-hist-audit', 'parspack-hist-admin', 'ORDER_PAID', 'ServiceOrder',
  'parspack-hist-order', '{"amountRial":12500000,"provider":"PARSPACK"}'::jsonb,
  'parspack-hist-audit-1'
);

INSERT INTO "AdminCommandReceipt" (
  id, operation, "idempotencyKey", "requestFingerprint", "actorUserId",
  "infrastructureOrderId", "serviceOrderId", "resultSnapshot"
) VALUES (
  'parspack-hist-approval', 'ADMIN_REFUND_REVIEW', 'parspack-hist-approval-1',
  'parspack-hist-fp', 'parspack-hist-admin', 'parspack-hist-infra',
  'parspack-hist-order', '{"decision":"review","amountRial":12500000}'::jsonb
);

INSERT INTO "ProviderFundingConfirmation" (
  id, "infrastructureOrderId", attempt, provider, "requiredAmountRial",
  "fundedAmountRial", "confirmedById", "idempotencyKey"
) VALUES (
  'parspack-hist-funding', 'parspack-hist-infra', 1, 'PARSPACK', 8000000,
  8000000, 'parspack-hist-admin', 'parspack-hist-funding-1'
);

INSERT INTO "StorefrontAssortmentSlot" (
  id, tier, role, "sortOrder", "catalogItemId", enabled, "updatedAt"
) VALUES (
  'parspack-hist-slot', 'NO', 'PRIMARY', 1, 'parspack-hist-catalog', true,
  CURRENT_TIMESTAMP
);

INSERT INTO "OperationalIncident" (
  id, provider, operation, "safeCode", title, "safeMessage", severity,
  status, fingerprint, "updatedAt"
) VALUES (
  'parspack-hist-incident', 'PARSPACK', 'CREATE_INSTANCE', 'provider_timeout',
  'ParsPack fixture incident', 'Historical provider incident retained for audit.',
  'CRITICAL', 'OPEN', 'parspack-hist-incident-fp', CURRENT_TIMESTAMP
);
