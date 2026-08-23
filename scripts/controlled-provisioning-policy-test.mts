import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import { submitProvisioningOnce } from "../lib/infrastructure/provisioning-orchestrator.ts";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("the worker dispatches only a recorded Admin approval and keeps delivery pending", async () => {
  const [dispatch, worker, health, flow] = await Promise.all([
    source("lib/infrastructure/provision-dispatch.ts"),
    source("lib/infrastructure/provisioning-service.ts"),
    source("lib/infrastructure/health-check-service.ts"),
    source("lib/product-flow/state-machine.ts"),
  ]);

  assert.match(dispatch, /operation:\s*"APPROVE_PROVISION"/);
  assert.match(dispatch, /result\.approved === true/);
  assert.match(dispatch, /parseLockedProvisioningSelection/);
  assert.match(dispatch, /assignReservedInventoryTx/);
  assert.match(dispatch, /transferInventoryCredentialToInstanceTx/);
  assert.match(dispatch, /const idempotencyKey = `provision-dispatch:\$\{order\.id\}`/);
  assert.match(worker, /FROM "AdminCommandReceipt" approval/);
  assert.match(worker, /Provisioning requires a recorded Admin approval/);
  assert.match(flow, /"WAITING_ADMIN_DELIVERY_APPROVAL"/);
  assert.match(health, /to:\s*"WAITING_ADMIN_DELIVERY_APPROVAL"/);
  const healthSuccess = health.slice(health.indexOf('to: "WAITING_ADMIN_DELIVERY_APPROVAL"'));
  assert.doesNotMatch(healthSuccess.slice(0, 1_500), /activateDeliveredServiceTx\(tx, order\.id\)/);
});

test("manual fulfillment persists encrypted credentials but cannot deliver the service", async () => {
  const [manual, credentialService, customerReveal] = await Promise.all([
    source("lib/infrastructure/manual-ready-delivery.ts"),
    source("lib/security/instance-credentials.ts"),
    source("app/api/account/instances/[id]/credentials/reveal/route.ts"),
  ]);

  assert.match(manual, /encryptCredential\(params\.secret\)/);
  assert.match(manual, /credentialFingerprint\(params\.secret\)/);
  assert.match(manual, /operation: "APPROVE_PROVISION"/);
  assert.match(manual, /approvalResult\?\.approved !== true/);
  assert.match(manual, /to:\s*"WAITING_ADMIN_DELIVERY_APPROVAL"/);
  assert.match(manual, /status: CloudInstanceStatus\.PENDING/);
  assert.doesNotMatch(manual, /to:\s*"ACTIVE"|SubscriptionStatus|SecureDeliveryStatus\.DELIVERED/);
  assert.doesNotMatch(credentialService, /completeSecureDelivery/);
  assert.match(customerReveal, /requireCustomer/);
});

test("a timeout is reconciled before any later create retry", async () => {
  const adapter = new FakeCloudProviderAdapter({
    provider: "ARVAN",
    createBehavior: "timeout_after_accept",
  });
  const create = {
    productKind: "READY_INSTANT_SERVER" as const,
    region: "test-region",
    externalPlanId: "test-plan",
    externalImageId: "test-image",
    externalNetworkId: null,
    externalSecurityId: null,
    accessMethod: "SSH_KEY" as const,
    sshKeyEnabled: true,
    sshKeyName: "fixture-key",
    name: "abrchin-timeout-fixture",
    orderPublicId: "timeout-fixture-order",
    idempotencyKey: "timeout-fixture-provision-key",
  };
  const first = await submitProvisioningOnce({
    adapter,
    attempt: {
      paid: true,
      providerLocked: true,
      createSentAt: null,
      providerTaskId: null,
      providerResourceId: null,
      noResourceConfirmedAt: null,
    },
    create,
  });
  assert.equal(first.state, "RECONCILING");
  const second = await submitProvisioningOnce({
    adapter,
    attempt: {
      paid: true,
      providerLocked: true,
      createSentAt: new Date(),
      providerTaskId: null,
      providerResourceId: null,
      noResourceConfirmedAt: null,
    },
    create,
  });
  assert.equal(second.state, "EXISTING_RESOURCE");
  assert.equal(adapter.createCalls.length, 1);
});
