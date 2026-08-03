import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("second Admin approval alone activates a ready service", async () => {
  const [delivery, health, flow] = await Promise.all([
    source("lib/infrastructure/delivery-approval.ts"),
    source("lib/infrastructure/health-check-service.ts"),
    source("lib/product-flow/state-machine.ts"),
  ]);

  assert.match(delivery, /operation: "APPROVE_DELIVERY"/);
  assert.match(delivery, /assertAdminActorTx/);
  assert.match(delivery, /replayAdminCommandTx/);
  assert.match(delivery, /from: "WAITING_ADMIN_DELIVERY_APPROVAL"/);
  assert.match(delivery, /to: "DELIVERED"/);
  assert.match(delivery, /activateApprovedDeliveryTx\(tx, order\.id\)/);
  assert.match(delivery, /operation: "HOLD_DELIVERY"/);
  assert.match(delivery, /to: "PROVISIONING_MANUAL_REVIEW"/);
  assert.match(health, /export async function activateApprovedDeliveryTx/);
  assert.match(flow, /WAITING_ADMIN_DELIVERY_APPROVAL: \[/);
});

test("credentials stay absent from initial customer/admin views and use protected reveal paths", async () => {
  const [adminPage, adminReveal, customerRoute, customerPage, credentials] = await Promise.all([
    source("app/admin/instances/[id]/page.tsx"),
    source("app/api/admin/instances/[id]/credentials/reveal/route.ts"),
    source("app/api/account/instances/[id]/credentials/reveal/route.ts"),
    source("app/account/orders/[id]/page.tsx"),
    source("lib/security/instance-credentials.ts"),
  ]);

  assert.match(adminPage, /AdminCredentialReveal/);
  assert.match(adminReveal, /requireAdminUser/);
  assert.match(adminReveal, /adminCredentialRevealLimiter/);
  assert.match(adminReveal, /CREDENTIAL_ADMIN_REVIEWED/);
  assert.match(customerRoute, /requireCustomer/);
  assert.match(customerRoute, /credentialRevealLimiter/);
  assert.match(credentials, /userId: params\.userId/);
  assert.match(credentials, /status: CloudInstanceStatus\.ACTIVE/);
  assert.match(credentials, /productFlowState: "ACTIVE"/);
  assert.match(credentials, /writeAuditLog\(/);
  assert.match(credentials, /productFlowState: "WAITING_ADMIN_DELIVERY_APPROVAL"/);
  assert.match(customerPage, /waitingForAdminDelivery/);
  assert.doesNotMatch(adminPage, /ciphertext|authTag|credential\.secret/);
});
