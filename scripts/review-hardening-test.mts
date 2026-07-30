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
  assert.match(plans, /requestCatalogSync/);
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
  assert.match(health, /provider_network_mismatch/);
  assert.match(health, /HEALTH_CHECK_FAILED/);
  assert.match(health, /DELIVERY_RETRYABLE/);
  assert.match(health, /serviceSubscription\.upsert/);
  assert.doesNotMatch(provisioning, /serviceSubscription\.upsert/);
});

test("review migrations prevent double markup and preserve ambiguous legacy states safely", async () => {
  const multi = await source(
    "prisma/migrations/20260730160000_multi_provider_routing/migration.sql",
  );
  const hardening = await source(
    "prisma/migrations/20260730190000_provider_review_hardening/migration.sql",
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
});
