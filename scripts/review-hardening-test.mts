import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path: string) {
  return readFile(path, "utf8");
}

test("customer paths never run a full provider catalog sync", async () => {
  for (const path of [
    "lib/orders/plans.ts",
    "lib/orders/service.ts",
    "lib/recommendation/quote-service.ts",
    "lib/subscriptions/service.ts",
  ]) {
    const file = await source(path);
    assert.doesNotMatch(file, /refreshMultiProviderCatalog/);
    assert.doesNotMatch(file, /refreshProviderCatalogForPricing/);
  }
  const plans = await source("lib/orders/plans.ts");
  assert.match(plans, /getCatalogFreshness/);
  assert.doesNotMatch(plans, /requestCatalogSync/);
  const sync = await source(
    "lib/infrastructure/multi-provider-catalog-service.ts",
  );
  assert.match(sync, /syncLeaseToken/);
  assert.match(sync, /catalog_sync_already_running/);
});

test("conversation resume is database authoritative and revision conflicts return 409", async () => {
  const sessionRoute = await source(
    "app/api/recommendations/sessions/[id]/route.ts",
  );
  const answerRoute = await source(
    "app/api/recommendations/sessions/[id]/answers/route.ts",
  );
  const sessionService = await source(
    "lib/recommendation/session-service.ts",
  );
  const client = await source("components/conversation-builder.tsx");
  assert.match(sessionRoute, /getConversationSession/);
  assert.match(answerRoute, /expectedRevision/);
  assert.match(answerRoute, /409/);
  assert.match(sessionService, /revision: input\.expectedRevision/);
  assert.match(sessionService, /recommendationQuote\.updateMany/);
  assert.match(sessionService, /prisma\.\$transaction/);
  assert.match(client, /databaseSession/);
  assert.match(
    client,
    /databaseSession|\/api\/recommendations\/sessions/,
  );
});

test("guest ownership uses an HttpOnly cookie and explicit fail-closed claim", async () => {
  const cookie = await source(
    "lib/recommendation/guest-session-cookie.ts",
  );
  const createRoute = await source(
    "app/api/recommendations/sessions/route.ts",
  );
  const login = await source("components/login-form.tsx");
  const orders = await source("lib/orders/service.ts");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(createRoute, /guestToken:\s*session\.guestToken/);
  assert.match(login, /claimResponse\.ok/);
  assert.match(orders, /quote\.session\.userId !== userId/);
  assert.doesNotMatch(orders, /OR:\s*\[\{ userId \}, \{ userId: null \}\]/);
});

test("delivery configuration is real, locked and snapshotted before quote", async () => {
  const quote = await source("lib/recommendation/quote-service.ts");
  const delivery = await source(
    "lib/recommendation/delivery-service.ts",
  );
  const deliveryRoute = await source(
    "app/api/recommendations/sessions/[id]/delivery/route.ts",
  );
  const client = await source("components/conversation-builder.tsx");
  const payment = await source("lib/orders/pay-order-tx.ts");
  const arvan = await source(
    "lib/infrastructure/arvan/v1-adapter.ts",
  );
  assert.match(quote, /parseLockedDeliveryConfiguration/);
  assert.match(quote, /conversation_delivery_not_configured/);
  assert.match(quote, /configured_selection_quoted/);
  assert.match(quote, /deliveryConfigurationSnapshot/);
  assert.match(delivery, /resolveProviderSelectionDefaults/);
  assert.match(delivery, /customer_confirmed_delivery_configuration/);
  assert.match(delivery, /invalid_access_method_for_image/);
  assert.match(deliveryRoute, /expectedRevision/);
  assert.match(client, /تأیید تنظیم تحویل و دریافت Quote/);
  assert.match(client, /WINDOWS_PASSWORD/);
  assert.match(
    payment,
    /deliveryConfigurationSnapshot/,
  );
  assert.match(
    payment,
    /recommendationQuote\?\.externalImageId/,
  );
  assert.match(arvan, /\/servers\/options/);
  assert.match(arvan, /network_id/);
  assert.match(arvan, /arDefault/);
  assert.match(arvan, /provider_default_selection_missing/);
  assert.doesNotMatch(arvan, /network_ids:\s*\[\]/);
  assert.doesNotMatch(arvan, /security_groups:\s*\[\]/);
});

test("all product-flow mutations go through the optimistic central service", async () => {
  const stateService = await source("lib/product-flow/service.ts");
  assert.match(stateService, /productFlowRevision/);
  assert.match(stateService, /ownerFingerprint/);
  assert.match(stateService, /product_flow_idempotency_conflict/);
  assert.match(stateService, /updateMany/);
  assert.match(stateService, /fromRevision/);
  for (const path of [
    "lib/orders/service.ts",
    "lib/orders/pay-order-tx.ts",
    "lib/recommendation/quote-service.ts",
    "lib/recommendation/session-service.ts",
    "lib/infrastructure/funding.ts",
    "lib/infrastructure/provisioning-service.ts",
  ]) {
    const file = await source(path);
    assert.doesNotMatch(
      file,
      /(?:update|updateMany)\s*\(\s*\{[\s\S]{0,350}?data:\s*\{[\s\S]{0,200}?productFlowState:/,
      `${path} writes productFlowState directly`,
    );
    assert.doesNotMatch(file, /productFlowTransition\.createMany/);
  }
});

test("health and secure delivery gate activation and subscription", async () => {
  const provisioning = await source(
    "lib/infrastructure/provisioning-service.ts",
  );
  const health = await source(
    "lib/infrastructure/health-check-service.ts",
  );
  assert.match(
    provisioning,
    /providerObservedAt: observed\.observedAt/,
  );
  assert.doesNotMatch(
    provisioning,
    /networkId: locked\.externalNetworkId/,
  );
  assert.match(health, /MAX_CONNECT_ATTEMPTS = 3/);
  assert.match(health, /expectedNetworkId/);
  assert.match(health, /observedNetworkId/);
  assert.match(health, /PROVIDER_MANAGED/);
  assert.match(health, /topologyVerificationMode/);
  assert.match(health, /provider_network_mismatch/);
  assert.match(health, /HEALTH_CHECK_FAILED/);
  assert.match(health, /DELIVERY_RETRYABLE/);
  assert.match(health, /serviceSubscription\.upsert/);
  assert.doesNotMatch(provisioning, /serviceSubscription\.upsert/);
});

test("health retry is a provider-read-only worker job with guarded admin recovery", async () => {
  const retry = await source(
    "lib/infrastructure/health-retry-service.ts",
  );
  const provisioning = await source(
    "lib/infrastructure/provisioning-service.ts",
  );
  const route = await source(
    "app/api/admin/infrastructure/orders/[id]/health-retry/route.ts",
  );
  assert.match(retry, /HEALTH_RETRY_OPERATION/);
  assert.match(retry, /HEALTH_RETRY_LIMIT = 3/);
  assert.match(retry, /HEALTH_MANUAL_RECOVERY_OPERATION/);
  assert.match(retry, /findExistingResource/);
  assert.match(retry, /availableAt/);
  assert.match(retry, /PROVISIONING_MANUAL_REVIEW/);
  assert.doesNotMatch(retry, /\.createServer\(/);
  assert.match(
    provisioning,
    /operation === "health_check_manual_recovery"/,
  );
  assert.match(provisioning, /"availableAt" <= CURRENT_TIMESTAMP/);
  assert.match(route, /requireAdminUser/);
  assert.match(route, /rejectCrossOrigin/);
  assert.match(route, /readIdempotencyKey/);
  assert.match(route, /reason/);
});

test("terminal recovery and runtime refund preserve financial evidence", async () => {
  const migration = await source(
    "prisma/migrations/20260730234500_terminal_order_recovery/migration.sql",
  );
  const refund = await source("lib/orders/service.ts");
  assert.match(
    migration,
    /refund\."reversedEntryId" = debit\.id/,
  );
  assert.match(
    migration,
    /so\.status IN \('DRAFT', 'PENDING_PAYMENT', 'CANCELED'\)/,
  );
  assert.match(
    migration,
    /ServiceOrder_terminal_status_guard/,
  );
  assert.doesNotMatch(
    migration,
    /UPDATE "WalletLedgerEntry"/,
  );
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.match(refund, /wallet_refund_completed/);
  assert.match(refund, /assertProductFlowOwnerStateTx/);
  assert.match(refund, /refund-flow:/);
});

test("V4 scopes terminal remediation across the complete session graph", async () => {
  const migration = await source(
    "prisma/migrations/20260731003000_multi_order_terminal_recovery_v4/migration.sql",
  );
  assert.match(migration, /_AbrchinV4SessionGraph/);
  assert.match(migration, /nonTerminalSignatureCount/);
  assert.match(migration, /nonTerminalOwnersAligned/);
  assert.match(migration, /ProductFlowRemediationCase/);
  assert.match(
    migration,
    /v3_terminal_scope_repaired_from_live_sibling/,
  );
  assert.match(
    migration,
    /graph\."allTerminalGraphAligned"/,
  );
  assert.match(
    migration,
    /'migration:v4:terminal-order:' \|\| graph\."serviceOrderId",\s+NULL,/,
  );
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "PaymentTransaction"/);
  assert.doesNotMatch(
    migration,
    /SET[\s\S]{0,80}"providerSelectionSnapshot"/,
  );
});

test("health recovery has durable command receipts and lease fencing", async () => {
  const retry = await source(
    "lib/infrastructure/health-retry-service.ts",
  );
  const fence = await source(
    "lib/infrastructure/worker-fence.ts",
  );
  const provisioning = await source(
    "lib/infrastructure/provisioning-service.ts",
  );
  const durableHealth = await source(
    "lib/infrastructure/health-check-service.ts",
  );
  assert.match(retry, /persistAdminCommandReceiptTx/);
  assert.match(retry, /replayAdminCommandTx/);
  assert.match(retry, /resultSnapshot/);
  assert.match(retry, /finalizePending/);
  assert.match(retry, /assertProvisioningJobFenceTx/);
  assert.doesNotMatch(retry, /\.createServer\(/);
  assert.match(fence, /claimToken/);
  assert.match(fence, /leaseExpiresAt: \{ gt: new Date\(\) \}/);
  assert.match(provisioning, /randomUUID\(\)/);
  assert.match(provisioning, /claimToken: null/);
  assert.match(provisioning, /if \(!options\?\.claimToken\) return null/);
  assert.match(durableHealth, /HEALTH_RESULT_PERSISTED/);
  assert.match(provisioning, /ProvisioningNotificationOutbox|provisioningNotificationOutbox/);
});

test("V5 repair is monotonic, semantic, and financially isolated", async () => {
  const migration = await source(
    "prisma/migrations/20260731043000_terminal_and_worker_recovery_v5/migration.sql",
  );
  assert.match(migration, /hasV4RevisionRegression/);
  assert.match(migration, /maxTransitionRevision/);
  assert.match(migration, /semanticValid/);
  assert.match(migration, /targetRevision/);
  assert.match(
    migration,
    /"toRevision" <=\s+v4_transition\."fromRevision"/,
  );
  assert.doesNotMatch(migration, /UPDATE "Wallet"/);
  assert.doesNotMatch(migration, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(migration, /UPDATE "PaymentTransaction"/);
  assert.doesNotMatch(
    migration,
    /SET[\s\S]{0,80}"providerSelectionSnapshot"/,
  );
});

test("refund and provisioning retry fail closed on provider attempt evidence", async () => {
  const disposition = await source(
    "lib/infrastructure/resource-disposition.ts",
  );
  const refund = await source("lib/orders/service.ts");
  const retry = await source("lib/infrastructure/retry.ts");
  assert.match(disposition, /createSentAt/);
  assert.match(disposition, /providerTaskId/);
  assert.match(disposition, /providerResourceId/);
  assert.match(disposition, /NEEDS_RECONCILIATION/);
  assert.match(disposition, /LATEST_ATTEMPT_CONFIRMED_ABSENT/);
  assert.match(disposition, /RESOURCE_TERMINATED/);
  assert.match(refund, /assessRefundResourceSafety/);
  assert.match(refund, /reconcileNoResourceConfirmedJobId/);
  assert.match(retry, /provider-absence-confirmed:/);
  assert.match(retry, /findExistingResource/);
});

test("idempotency compares stable request payloads", async () => {
  const audit = await source("lib/audit/service.ts");
  const funding = await source("lib/infrastructure/funding.ts");
  const retry = await source(
    "lib/infrastructure/health-retry-service.ts",
  );
  const retryRoute = await source(
    "app/api/admin/infrastructure/orders/[id]/health-retry/route.ts",
  );
  assert.match(audit, /stableJson\(existing\.afterData/);
  assert.match(audit, /IdempotencyConflictError/);
  assert.match(audit, /pg_advisory_xact_lock/);
  assert.match(audit, /createMany/);
  assert.match(
    funding,
    /existingConfirmation\.fundedAmountRial !== fundedAmountRial/,
  );
  assert.match(retry, /requestFingerprint/);
  assert.match(retry, /assertHealthOperationReplay/);
  assert.match(retry, /persistAdminCommandReceiptTx/);
  assert.match(retryRoute, /idempotency_conflict/);
  assert.match(retryRoute, /409/);
});

test("direct catalog checkout uses audited bootstrap and request idempotency", async () => {
  const quote = await source("lib/recommendation/quote-service.ts");
  const flow = await source("lib/product-flow/service.ts");
  const cloudRoute = await source(
    "app/api/cloud-servers/quotes/route.ts",
  );
  const readyRoute = await source(
    "app/api/ready-servers/quotes/route.ts",
  );
  assert.match(quote, /catalogCheckoutIdempotencyKey/);
  assert.match(quote, /pg_advisory_xact_lock/);
  assert.match(quote, /productFlowState: "DRAFT"/);
  assert.doesNotMatch(
    quote,
    /recommendationSession\.create\([\s\S]{0,900}?productFlowState: "DELIVERY_CONFIGURED"/,
  );
  assert.match(flow, /bootstrapCatalogCheckoutFlowTx/);
  assert.match(flow, /catalog_delivery_configured/);
  assert.match(cloudRoute, /readIdempotencyKey/);
  assert.match(readyRoute, /readIdempotencyKey/);
});

test("review migrations prevent double markup and preserve ambiguous legacy states safely", async () => {
  const multi = await source(
    "prisma/migrations/20260730160000_multi_provider_routing/migration.sql",
  );
  const hardening = await source(
    "prisma/migrations/20260730190000_provider_review_hardening/migration.sql",
  );
  const recovery = await source(
    "prisma/migrations/20260730223000_provider_review_recovery_v2/migration.sql",
  );
  assert.match(
    multi,
    /'legacy-parspack-ready', 'PARSPACK', 'v1', 'READY_INSTANT_SERVER',\s*0,\s*"enabled"/,
  );
  assert.match(
    hardening,
    /WHEN "productFlowState" = 'QUOTED' THEN 'RECOMMENDED'/,
  );
  assert.match(hardening, /CREATE TABLE "InfrastructureHealthCheck"/);
  assert.match(hardening, /CREATE TABLE "SecureDeliveryEvent"/);
  assert.doesNotMatch(hardening, /UPDATE "WalletLedgerEntry"/);
  assert.match(recovery, /row_number\(\) OVER/);
  assert.match(recovery, /PARTITION BY q\."sessionId"/);
  assert.match(recovery, /legacy_checkout_graph_aligned/);
  assert.match(
    recovery,
    /paid\."sessionState" IS DISTINCT FROM paid\."targetState"/,
  );
  assert.match(
    recovery,
    /paid\."infrastructureOrderState"[\s\S]*IS DISTINCT FROM paid\."targetState"/,
  );
  assert.doesNotMatch(recovery, /UPDATE "WalletLedgerEntry"/);
  assert.doesNotMatch(recovery, /SET "providerSelectionSnapshot"/);
});
