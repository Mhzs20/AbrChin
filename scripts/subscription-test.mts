import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addBillingMonth,
  addGracePeriod,
} from "../lib/subscriptions/period.ts";

test("billing months preserve calendar intent at month boundaries", () => {
  assert.equal(
    addBillingMonth(new Date("2028-01-31T10:00:00.000Z")).toISOString(),
    "2028-02-29T10:00:00.000Z",
  );
  assert.equal(
    addBillingMonth(new Date("2026-05-15T10:00:00.000Z")).toISOString(),
    "2026-06-15T10:00:00.000Z",
  );
  assert.equal(
    addGracePeriod(new Date("2026-06-15T10:00:00.000Z")).toISOString(),
    "2026-06-22T10:00:00.000Z",
  );
});

test("renewal requires a revalidated snapshot and never auto-charges", async () => {
  const renewal = await readFile("lib/subscriptions/service.ts", "utf8");
  const provisioning = await readFile("lib/infrastructure/provisioning-service.ts", "utf8");
  const worker = await readFile("scripts/provisioning-worker-entry.ts", "utf8");
  const migration = await readFile(
    "prisma/migrations/20260729120000_service_subscriptions/migration.sql",
    "utf8",
  );

  assert.match(renewal, /renewal_quote_pay_/);
  assert.match(renewal, /availableBalance: \{ gte: quote\.finalPriceRialSnapshot \}/);
  assert.match(renewal, /LedgerType\.SERVICE_RENEWAL/);
  assert.match(renewal, /providerBasePriceRialSnapshot/);
  assert.match(renewal, /markupBasisPointsSnapshot/);
  assert.match(renewal, /finalPriceRialSnapshot/);
  assert.match(renewal, /samePriceSnapshot/);
  assert.match(renewal, /RENEWAL_QUOTE_VALIDITY_MS = 10 \* 60 \* 1000/);
  assert.match(renewal, /processSubscriptionLifecycle/);
  assert.match(renewal, /SubscriptionStatus\.PAST_DUE/);
  assert.match(renewal, /SubscriptionStatus\.SUSPENDED/);
  assert.doesNotMatch(renewal, /if \(subscription\.autoRenew\)/);
  assert.match(worker, /SUBSCRIPTION_LIFECYCLE_INTERVAL_MS/);
  assert.match(worker, /processSubscriptionLifecycle/);
  assert.match(provisioning, /serviceSubscription\.upsert/);
  assert.match(migration, /Existing active instances receive a full period/);
  assert.match(migration, /CURRENT_TIMESTAMP \+ INTERVAL '1 month'/);
});
