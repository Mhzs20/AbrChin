import assert from "node:assert/strict";
import test from "node:test";

import {
  InfrastructureProductKind,
  InfrastructureProvider,
} from "@prisma/client";

import { ArvanV1Adapter } from "../lib/infrastructure/arvan/v1-adapter.ts";
import { FakeCloudProviderAdapter } from "../lib/infrastructure/fake-cloud-provider-adapter.ts";
import { assessProviderObservation } from "../lib/infrastructure/health-check-service.ts";
import { parseLockedProvisioningSelection } from "../lib/infrastructure/provisioning-service.ts";
import {
  buildConversationResumeLookup,
  createGuestSessionCredential,
  verifyGuestSessionCredential,
} from "../lib/recommendation/session-service.ts";

const lockedDelivery = {
  provider: InfrastructureProvider.ARVAN,
  providerApiVersion: "v1",
  productKind: InfrastructureProductKind.CLOUD_SERVER,
  region: "ir-thr-ba1",
  externalPlanId: "g6",
  externalImageId: "ubuntu",
  externalNetworkId: "network-1",
  externalSecurityId: "security-1",
  topologyVerificationMode: "STRICT_OBSERVED",
  accessMethod: "SSH_KEY",
  sshKeyName: "abrchin-key",
};

test("worker accepts only the exact paid provider selection snapshot", () => {
  const parsed = parseLockedProvisioningSelection({
    snapshot: {
      ...lockedDelivery,
      deliveryConfiguration: lockedDelivery,
    },
    provider: InfrastructureProvider.ARVAN,
    providerApiVersion: "v1",
    productKind: InfrastructureProductKind.CLOUD_SERVER,
  });
  assert.equal(parsed.externalPlanId, "g6");
  assert.equal(parsed.accessMethod, "SSH_KEY");
  assert.equal(parsed.sshKeyName, "abrchin-key");

  assert.throws(
    () =>
      parseLockedProvisioningSelection({
        snapshot: {
          ...lockedDelivery,
          externalSecurityId: null,
          deliveryConfiguration: lockedDelivery,
        },
        provider: InfrastructureProvider.ARVAN,
        providerApiVersion: "v1",
        productKind: InfrastructureProductKind.CLOUD_SERVER,
      }),
    /incomplete/i,
  );
});

test("fake adapter exposes correct, wrong and unknown observed topology", async () => {
  async function observe(
    observedResource:
      | {
          networkIds?: string[] | null;
          securityIds?: string[] | null;
        }
      | undefined,
  ) {
    const adapter = new FakeCloudProviderAdapter({ observedResource });
    const task = await adapter.createServer({
      productKind: InfrastructureProductKind.CLOUD_SERVER,
      region: "ir-thr-ba1",
      externalPlanId: "g6",
      externalImageId: "ubuntu",
      externalNetworkId: "network-1",
      externalSecurityId: "security-1",
      accessMethod: "ONE_TIME_PASSWORD",
      name: "abrchin-order-1",
      orderPublicId: "order-1",
      idempotencyKey: "attempt-1",
    });
    await adapter.getTaskStatus({
      region: "ir-thr-ba1",
      resourceId: task.resourceId,
    });
    return adapter.findExistingResource({
      region: "ir-thr-ba1",
      orderPublicId: "order-1",
      expectedName: "abrchin-order-1",
      providerResourceId: task.resourceId,
    });
  }

  const correct = await observe(undefined);
  assert.deepEqual(correct?.networkIds, ["network-1"]);
  assert.deepEqual(correct?.securityIds, ["security-1"]);
  assert.ok(correct?.observedAt instanceof Date);
  assert.equal(
    assessProviderObservation({
      topologyVerificationMode: "STRICT_OBSERVED",
      providerState: correct!.state,
      ipv4: correct!.ipv4,
      providerObservedAt: correct!.observedAt,
      expectedNetworkId: "network-1",
      observedNetworkId: correct!.networkIds![0]!,
      expectedSecurityId: "security-1",
      observedSecurityId: correct!.securityIds![0]!,
    }).ready,
    true,
  );

  const wrong = await observe({
    networkIds: ["network-other"],
    securityIds: ["security-other"],
  });
  assert.deepEqual(wrong?.networkIds, ["network-other"]);
  assert.deepEqual(wrong?.securityIds, ["security-other"]);
  assert.equal(
    assessProviderObservation({
      topologyVerificationMode: "STRICT_OBSERVED",
      providerState: wrong!.state,
      ipv4: wrong!.ipv4,
      providerObservedAt: wrong!.observedAt,
      expectedNetworkId: "network-1",
      observedNetworkId: wrong!.networkIds![0]!,
      expectedSecurityId: "security-1",
      observedSecurityId: wrong!.securityIds![0]!,
    }).code,
    "provider_network_mismatch",
  );

  const unknown = await observe({
    networkIds: null,
    securityIds: null,
  });
  assert.equal(unknown?.networkIds, null);
  assert.equal(unknown?.securityIds, null);
  assert.equal(
    assessProviderObservation({
      topologyVerificationMode: "STRICT_OBSERVED",
      providerState: unknown!.state,
      ipv4: unknown!.ipv4,
      providerObservedAt: unknown!.observedAt,
      expectedNetworkId: "network-1",
      observedNetworkId: null,
      expectedSecurityId: "security-1",
      observedSecurityId: null,
    }).ready,
    false,
  );
});

test("provider-managed topology still requires active state, IPv4 and observation", () => {
  const base = {
    topologyVerificationMode: "PROVIDER_MANAGED" as const,
    providerState: "active",
    ipv4: "192.0.2.20",
    providerObservedAt: new Date(),
    expectedNetworkId: null,
    observedNetworkId: null,
    expectedSecurityId: null,
    observedSecurityId: null,
  };
  assert.deepEqual(assessProviderObservation(base), {
    ready: true,
    code: "provider_managed_topology_verified",
  });
  assert.equal(
    assessProviderObservation({ ...base, ipv4: null }).ready,
    false,
  );
  assert.equal(
    assessProviderObservation({
      ...base,
      providerState: "unknown",
    }).ready,
    false,
  );
  assert.equal(
    assessProviderObservation({
      ...base,
      providerObservedAt: null,
    }).ready,
    false,
  );
});

test("ParsPack paid snapshots normalize legacy defaults to provider-managed topology", () => {
  const delivery = {
    provider: InfrastructureProvider.PARSPACK,
    providerApiVersion: "v1",
    productKind: InfrastructureProductKind.READY_INSTANT_SERVER,
    region: "tehran",
    externalPlanId: "s1",
    externalImageId: "ubuntu",
    externalNetworkId: "provider-default",
    externalSecurityId: "provider-default",
    accessMethod: "ONE_TIME_PASSWORD",
  };
  const parsed = parseLockedProvisioningSelection({
    snapshot: {
      ...delivery,
      deliveryConfiguration: delivery,
    },
    provider: InfrastructureProvider.PARSPACK,
    providerApiVersion: "v1",
    productKind:
      InfrastructureProductKind.READY_INSTANT_SERVER,
  });
  assert.equal(parsed.topologyVerificationMode, "PROVIDER_MANAGED");
  assert.equal(parsed.externalNetworkId, null);
  assert.equal(parsed.externalSecurityId, null);
});

test("Arvan SSH key validation uses the official read-only v1 endpoint", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const adapter = new ArvanV1Adapter({
    apiKey: "test-only",
    regionCodes: ["ir-thr-ba1"],
    maxGetAttempts: 1,
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
      });
      return new Response(
        JSON.stringify([
          {
            id: "key-1",
            name: "abrchin-key",
            fingerprint: "SHA256:test",
            public_key: "ssh-ed25519 AAAA test",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const keys = await adapter.listSshKeys("ir-thr-ba1");
  assert.equal(keys[0]?.name, "abrchin-key");
  assert.equal(keys[0]?.fingerprint, "SHA256:test");
  assert.deepEqual(requests, [
    {
      url: "https://napi.arvancloud.ir/ecc/v1/regions/ir-thr-ba1/ssh-keys",
      method: "GET",
    },
  ]);
});

test("guest resume uses an HttpOnly credential hash and fails closed", () => {
  const credential = createGuestSessionCredential();
  const lookup = buildConversationResumeLookup({
    guestToken: credential.token,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.ok(lookup && "guestAccessTokenHash" in lookup);
  assert.equal(JSON.stringify(lookup).includes(credential.token), false);
  assert.equal(
    verifyGuestSessionCredential(
      credential.token,
      credential.hash,
    ),
    true,
  );
  assert.equal(
    verifyGuestSessionCredential("forged-token", credential.hash),
    false,
  );
  assert.equal(buildConversationResumeLookup({}), null);
});
