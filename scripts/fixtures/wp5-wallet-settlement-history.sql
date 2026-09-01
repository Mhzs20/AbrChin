-- Realistic wallet, payment, quote, order, and MessageGo settlement history
-- for upgrade tests. Integer rial only. No secrets or personal data.
-- Applied on schemas that already contain MessageGo settlement tables
-- (head 20260901120000_messagego_customer_pricing or later).

INSERT INTO "User" (
  id, mobile, "displayName", role, "accountStatus", "mobileVerifiedAt", "updatedAt"
) VALUES (
  'wp5-hist-user', '09120009901', 'WP5 History Customer', 'CUSTOMER',
  'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "User" (
  id, mobile, "displayName", role, "accountStatus", "mobileVerifiedAt", "updatedAt"
) VALUES (
  'wp5-hist-admin', '09120009902', 'WP5 History Admin', 'ADMIN',
  'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "Wallet" (
  id, "userId", "availableBalance", status, "updatedAt"
) VALUES (
  'wp5-hist-wallet', 'wp5-hist-user', 4999800, 'ACTIVE', CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO "ProviderCatalogItem" (
  id, provider, "regionCode", "sizeCode", "sizeName",
  "compatibleImageCodes", vcpu, "ramMb", "diskGb", available, active,
  "priceMonthlyAmount", "currencyCode", "amountUnit", "lastSyncedAt",
  "updatedAt", "apiVersion", "productKind", "externalPlanId",
  "externalKey", status, "providerMonthlyPriceIrr", "lastSeenAt",
  "rawPayload", "payloadHash", "catalogVersion", source,
  "manualAvailableUnits", "manualPriceValidUntil", "manualLastVerifiedAt"
) VALUES (
  'wp5-hist-catalog', 'ARVAN', 'tehran', 'g1-2', 'G1-2',
  '["ubuntu"]', 2, 2048, 40, true, true,
  1000000, 'IRR', 'RIAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  'v1', 'READY_INSTANT_SERVER', 'g1-2',
  'arvan:v1:tehran:g1-2:wp5hist', 'ACTIVE', 1000000,
  CURRENT_TIMESTAMP, '{"source":"wp5-settlement-history"}'::jsonb,
  'wp5-hist-payload', 'wp5-hist-v1', 'MANUAL_ADMIN',
  8, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP
);

INSERT INTO "InfrastructurePlan" (
  id, code, title, provider, "regionCode", "sizeCode", "imageCode",
  "deliveryMode", "salePriceRial", "estimatedProviderCostRial",
  active, "updatedAt", vcpu, "ramGb", "storageGb",
  "renewalPriceRial", "parchinIncluded", "catalogItemId",
  "catalogMappingStatus", "providerApiVersion", "productKind",
  "minimumParchinLevel", "publicationStatus", "offerSource",
  "offerLastVerifiedAt", "offerPriceValidUntil", "billingModel"
) VALUES (
  'wp5-hist-plan', 'WP5_HIST_G1', 'WP5 History G1', 'ARVAN',
  'tehran', 'g1-2', 'ubuntu', 'MANAGED', 1000000, 1000000,
  true, CURRENT_TIMESTAMP, 2, 2, 40, 1000000, true,
  'wp5-hist-catalog', 'MAPPED', 'v1', 'READY_INSTANT_SERVER',
  'PARCHIN_START', 'PUBLISHED', 'MANUAL_ADMIN',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days', 'PREPAID_TERM'
);

INSERT INTO "RecommendationSession" (
  id, "userId", status, answers, "answerSources", "productFlowState",
  "expiresAt", "createdAt", "updatedAt"
) VALUES (
  'wp5-hist-session', 'wp5-hist-user', 'CONVERTED', '{}'::jsonb, '{}'::jsonb, 'CONVERTED',
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
  "providerPayloadHash", "expiresAt", "updatedAt", "termMonths", "termDiscountBps"
) VALUES (
  'wp5-hist-quote', 'wp5-hist-session', 'wp5-hist-plan', 'RECOMMENDED',
  'CONVERTED', 100, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
  5000000, 1000000, 'wp5-hist-catalog', 1000000, 0,
  5000000, 'IRR', CURRENT_TIMESTAMP, 'ARVAN', 'v1',
  'READY_INSTANT_SERVER', 'tehran', 'g1-2', 'ubuntu',
  'provider-default', 'provider-default', 2, 2048, 40, 'Ubuntu',
  1000000, 0, 'PARCHIN_START', 0, '[]'::jsonb, 0, 0, '[]'::jsonb,
  CURRENT_TIMESTAMP, 'wp5-hist-v1', 'wp5-hist-payload',
  CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP, 6, 1000
);

INSERT INTO "ServiceOrder" (
  id, "userId", title, amount, currency, status, "planId",
  "recommendationQuoteId", provider, "providerApiVersion", "productKind",
  "parchinLevel", "productFlowState", "paidAt", "updatedAt", "termMonths", "termDiscountBps"
) VALUES (
  'wp5-hist-order', 'wp5-hist-user', 'WP5 History Order',
  5000000, 'IRR', 'PAID', 'wp5-hist-plan',
  'wp5-hist-quote', 'ARVAN', 'v1', 'READY_INSTANT_SERVER',
  'PARCHIN_START', 'PAID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 6, 1000
);

INSERT INTO "InfrastructureOrder" (
  id, "serviceOrderId", "userId", "planId", provider, "providerApiVersion",
  "productKind", "parchinLevel", "deliveryMode", status, "requiredFundingRial",
  "productFlowState", "updatedAt"
) VALUES (
  'wp5-hist-infra', 'wp5-hist-order', 'wp5-hist-user',
  'wp5-hist-plan', 'ARVAN', 'v1', 'READY_INSTANT_SERVER',
  'PARCHIN_START', 'MANAGED', 'WAITING_ADMIN_FUNDING', 1000000,
  'AWAITING_ADMIN_PROVISION', CURRENT_TIMESTAMP
);

INSERT INTO "WalletTopUp" (
  id, "walletId", amount, gateway, status, authority, "gatewayReference",
  "idempotencyKey", "callbackTokenHash", "expiresAt", "verifiedAt", "updatedAt"
) VALUES (
  'wp5-hist-topup', 'wp5-hist-wallet', 10000000, 'MOCK', 'SUCCEEDED',
  'mock_wp5_hist_topup', 'mock_wp5_hist_topup',
  'wp5-hist-topup-idem', 'wp5histcallbackhash000000000000000000000000000000',
  CURRENT_TIMESTAMP + INTERVAL '30 minutes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO "PaymentAttempt" (
  id, "walletTopUpId", "attemptNumber", amount, currency, gateway, status,
  authority, "gatewayReference", "callbackTokenHash", "expiresAt",
  "verifiedAt", "idempotencyKey", "updatedAt"
) VALUES (
  'wp5-hist-attempt', 'wp5-hist-topup', 1, 10000000, 'IRR', 'MOCK', 'SUCCEEDED',
  'mock_wp5_hist_attempt', 'mock_wp5_hist_attempt',
  'wp5histcallbackhash000000000000000000000000000000',
  CURRENT_TIMESTAMP + INTERVAL '30 minutes', CURRENT_TIMESTAMP,
  'payment-attempt:wp5-hist-topup:1', CURRENT_TIMESTAMP
);

INSERT INTO "WalletLedgerEntry" (
  id, "walletId", direction, type, amount, status, "referenceType", "referenceId",
  "idempotencyKey", "balanceAfter", description
) VALUES
  (
    'wp5-hist-ledger-topup', 'wp5-hist-wallet', 'CREDIT', 'TOP_UP', 10000000,
    'COMPLETED', 'wallet_topup', 'wp5-hist-topup', 'wp5-hist-ledger-topup',
    10000000, 'history top-up'
  ),
  (
    'wp5-hist-ledger-order', 'wp5-hist-wallet', 'DEBIT', 'SERVICE_PURCHASE', 5000000,
    'COMPLETED', 'order', 'wp5-hist-order', 'wp5-hist-ledger-order',
    5000000, 'history order debit'
  ),
  (
    'wp5-hist-ledger-hold', 'wp5-hist-wallet', 'DEBIT', 'MESSAGEGO_RESERVE_HOLD', 250,
    'COMPLETED', 'messagego_reservation', 'wp5-hist-reservation',
    'wp5-hist-ledger-hold', 4999750, 'history reserve hold'
  ),
  (
    'wp5-hist-ledger-release', 'wp5-hist-wallet', 'CREDIT', 'MESSAGEGO_HOLD_RELEASE', 50,
    'COMPLETED', 'messagego_reservation', 'wp5-hist-reservation',
    'wp5-hist-ledger-release', 4999800, 'history leftover release'
  );

INSERT INTO "MessageGoCustomerPrice" (
  "stableModelAlias", revision, "pricingVersion", "pricingFingerprint",
  currency, "inputRialPerMillion", "outputRialPerMillion",
  "maxInputTokens", "maxOutputTokens", "effectiveAt"
) VALUES (
  'messagego.fast', 1, 'price.v2.history',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'IRR', 1000000, 1000000, 1000000, 1000000,
  TIMESTAMP '2026-08-01 00:00:00'
) ON CONFLICT ("stableModelAlias", revision) DO NOTHING;

INSERT INTO "MessageGoAuthorityReservation" (
  id, "accountId", "walletId", "productId", "workspaceId", "runId",
  "usageReservationId", "callerServiceId", "holdAmountRial", "remainingHoldRial",
  "settledAmountRial", status, "pricingFingerprint", "pricingVersion",
  "modelAlias", "estimatedMaxInputTokens", "requestedMaxOutputTokens",
  "customerInputRialPerMillion", "customerOutputRialPerMillion",
  "providerPricingFingerprint", "providerPricingVersion",
  "reserveOperationId", "updatedAt"
) VALUES (
  'wp5-hist-reservation', 'wp5-hist-user', 'wp5-hist-wallet', 'prod_a', 'ws_a',
  'run_wp5_hist', 'ures_wp5_hist', 'messagego-runtime', 250, 0, 200,
  'SETTLED', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'price.v2.history', 'messagego.fast', 100, 150, 1000000, 1000000,
  'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
  'provider-price.v1', 'op_wp5_hist_reserve', CURRENT_TIMESTAMP
);

INSERT INTO "MessageGoSettlementOperation" (
  id, "operationId", kind, "bodyFingerprint", "reservationId", "accountId",
  "outcomeJson"
) VALUES
  (
    'wp5-hist-op-reserve', 'op_wp5_hist_reserve', 'RESERVE',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'wp5-hist-reservation', 'wp5-hist-user',
    '{"status":"reserved","hold_amount":"250"}'::jsonb
  ),
  (
    'wp5-hist-op-settle', 'op_wp5_hist_settle', 'SETTLE',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'wp5-hist-reservation', 'wp5-hist-user',
    '{"status":"settled","settled_amount":"200"}'::jsonb
  );

INSERT INTO "MessageGoReservationEvent" (
  id, "reservationId", kind, "operationId", "payloadJson"
) VALUES
  (
    'wp5-hist-evt-reserve', 'wp5-hist-reservation', 'reserved',
    'op_wp5_hist_reserve', '{"hold_amount":"250"}'::jsonb
  ),
  (
    'wp5-hist-evt-settle', 'wp5-hist-reservation', 'settled',
    'op_wp5_hist_settle', '{"settled_amount":"200"}'::jsonb
  );

INSERT INTO "MessageGoS2SReplayNonce" (
  "serviceId", "keyId", nonce, "expiresAt"
) VALUES (
  'messagego-runtime', 'mg-to-ac-1', 'wp5-hist-nonce-1',
  CURRENT_TIMESTAMP + INTERVAL '5 minutes'
);

INSERT INTO "AuditLog" (
  id, "actorUserId", action, "entityType", "entityId", "idempotencyKey", "afterData"
) VALUES (
  'wp5-hist-audit', 'wp5-hist-admin', 'provision_approved', 'infrastructure_order',
  'wp5-hist-infra', 'wp5-hist-audit-provision',
  '{"approved":true,"containsSecret":false}'::jsonb
);

INSERT INTO "AdminCommandReceipt" (
  id, operation, "idempotencyKey", "requestFingerprint", "actorUserId",
  "infrastructureOrderId", "resultSnapshot"
) VALUES (
  'wp5-hist-receipt', 'APPROVE_PROVISION', 'wp5-hist-admin-provision',
  'wp5-hist-admin-provision-fp', 'wp5-hist-admin', 'wp5-hist-infra',
  '{"approved":true,"containsSecret":false}'::jsonb
);
