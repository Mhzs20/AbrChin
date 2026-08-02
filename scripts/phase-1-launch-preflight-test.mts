import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("production placeholders keep every public-sale and mutation gate fail-closed", async () => {
  const productionEnv = await source(".env.production.example");
  for (const key of [
    "PARSPACK_PUBLIC_SALE_ENABLED=false",
    "PARSPACK_MUTATIONS_ENABLED=false",
    "ARVAN_PUBLIC_SALE_ENABLED=false",
    "ARVAN_READY_PUBLIC_SALE_ENABLED=false",
    "ARVAN_CLOUD_PUBLIC_SALE_ENABLED=false",
    "ARVAN_MUTATIONS_ENABLED=false",
    "MANUAL_READY_PUBLIC_SALE_ENABLED=false",
  ]) {
    assert.match(productionEnv, new RegExp(`^${key}$`, "m"));
  }
  assert.match(productionEnv, /^CREDENTIAL_ENCRYPTION_KEY=$/m);
  assert.match(productionEnv, /^KAVENEGAR_API_KEY=$/m);
  assert.match(productionEnv, /^ZIBAL_MERCHANT=$/m);
});

test("the Founder path documents both Admin gates and never uses the retired delivery shortcut", async () => {
  const [runbook, checklist, payment, orderPayment, manual, delivery] = await Promise.all([
    source("docs/launch-runbook.md"),
    source("docs/phase-1-founder-checklist.md"),
    source("lib/payments/order-payment.ts"),
    source("lib/orders/pay-order-tx.ts"),
    source("lib/infrastructure/manual-ready-delivery.ts"),
    source("lib/infrastructure/delivery-approval.ts"),
  ]);

  assert.match(runbook, /fulfill-manually/);
  assert.match(runbook, /تأیید اول Admin/);
  assert.match(runbook, /تأیید نهایی تحویل/);
  assert.doesNotMatch(runbook, /\{id\}\/manual-delivery/);
  assert.match(checklist, /Waiting Admin Provision Approval/);
  assert.match(checklist, /تأیید دوم/);
  assert.match(orderPayment, /WAITING_ADMIN_FUNDING/);
  assert.doesNotMatch(orderPayment, /dispatchApprovedProvision/);
  assert.match(payment, /finalizeOrderPaymentFromCallback/);
  assert.match(manual, /WAITING_ADMIN_DELIVERY_APPROVAL/);
  assert.match(delivery, /operation: "APPROVE_DELIVERY"/);
});
