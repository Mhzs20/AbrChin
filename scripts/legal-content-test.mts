import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LEGAL_ENTITY,
  LEGAL_LAUNCH_REQUIRED_FIELDS,
  PUBLIC_CONTACT_EMAIL,
  isLegalLaunchReady,
  legalRobotsDirective,
  missingLegalLaunchFields,
} from "../lib/legal/config.ts";
import { REFUND_SCENARIOS } from "../lib/legal/refund-behavior.ts";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legal launch stays blocked until the owner supplies official identity fields", () => {
  assert.equal(isLegalLaunchReady(), false);
  assert.deepEqual(missingLegalLaunchFields(), [...LEGAL_LAUNCH_REQUIRED_FIELDS]);
  for (const field of LEGAL_LAUNCH_REQUIRED_FIELDS) {
    assert.equal(LEGAL_ENTITY[field], null);
  }
  assert.equal(PUBLIC_CONTACT_EMAIL, "hello@abrchin.ir");
  assert.deepEqual(legalRobotsDirective(), { index: false, follow: true });
});

test("contractual pages do not invent legal identity and are not indexed", async () => {
  const files = [
    "app/terms/page.tsx",
    "app/privacy/page.tsx",
    "app/refund-policy/page.tsx",
    "app/service-policy/page.tsx",
    "components/legal-document.tsx",
    "components/site-shell.tsx",
    "app/account/support/page.tsx",
  ];
  for (const path of files) {
    const text = await source(path);
    assert.doesNotMatch(text, /support@abrchin\.ir/);
    assert.doesNotMatch(text, /شناسه ملی \d/);
    assert.doesNotMatch(text, /شماره ثبت \d/);
    assert.doesNotMatch(text, /کد پستی/);
  }
  const legal = await source("components/legal-document.tsx");
  assert.match(legal, /legalRobotsDirective/);
  assert.match(legal, /LEGAL_CONFIG_VERSION/);
  const robots = await source("app/robots.ts");
  const sitemap = await source("app/sitemap.ts");
  assert.match(robots, /isLegalLaunchReady/);
  assert.match(sitemap, /isLegalLaunchReady/);
  const blocker = await source("docs/launch/legal-entity-blocker.md");
  assert.match(blocker, /companyLegalName/);
  assert.match(blocker, /nationalId/);
  assert.match(blocker, /BLOCKED/);
});

test("refund policy wording is sourced from backend-true scenarios", async () => {
  const page = await source("app/refund-policy/page.tsx");
  assert.match(page, /REFUND_SCENARIOS/);
  const ids = REFUND_SCENARIOS.map((item) => item.id);
  for (const required of [
    "cancel_before_wallet_debit",
    "cancel_after_debit_before_fulfillment",
    "fulfillment_failure",
    "duplicate_debit",
    "provider_failure",
    "customer_cancel_after_provisioning",
    "chargeback_or_topup_dispute",
    "refund_destination",
    "review_process",
  ]) {
    assert.ok(ids.includes(required), required);
  }
  const pay = await source("lib/orders/pay-order-tx.ts");
  const refund = await source("lib/orders/service.ts");
  const cancel = await source("lib/orders/customer-cancel-service.ts");
  const recovery = await source("lib/payments/recovery.ts");
  const types = await source("lib/payments/types.ts");
  assert.match(pay, /order_pay_/);
  assert.match(refund, /order_refund_/);
  assert.match(cancel, /order_cancel_refund_/);
  assert.match(types, /refundPayment/);
  assert.match(recovery, /controlled_topup_refund|gatewayRefundExecuted/);
  for (const scenario of REFUND_SCENARIOS) {
    assert.equal(scenario.automatic, false);
  }
});

test("third-party notices match actual dependency licenses and do not invent a project license", async () => {
  const notice = await source("NOTICE");
  const inventory = await source("docs/legal/copyright-inventory.md");
  assert.match(notice, /SIL Open Font License/);
  assert.match(notice, /lucide-react/);
  assert.match(notice, /Apache-2.0/);
  assert.match(notice, /MIT-0/);
  assert.match(inventory, /Owner decision required/);
  assert.doesNotMatch(inventory, /this project is licensed under MIT/);
  const ofl = await source("public/assets/fonts/OFL.txt");
  assert.match(ofl, /SIL Open Font License/);
});
