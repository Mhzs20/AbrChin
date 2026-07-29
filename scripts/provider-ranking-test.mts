import assert from "node:assert/strict";
import test from "node:test";

import {
  compareProviderOffers,
  type ProviderOfferSource,
} from "../lib/recommendation/provider-comparison.ts";
import { rankProviderOffers } from "../lib/recommendation/provider-ranking.ts";
import type { ProviderOffer, ResourceProfile } from "../lib/recommendation/types.ts";

const now = new Date("2026-07-28T12:00:00.000Z");
const profile: ResourceProfile = {
  vcpu: 4,
  ramGb: 8,
  storageGb: 80,
  regionPreference: "IRAN",
  deliveryMode: "RAW",
  backupPolicy: "NONE",
  needsResize: true,
};

function offer(overrides: Partial<ProviderOffer>): ProviderOffer {
  return {
    id: "offer-1",
    planId: "plan-1",
    provider: "PARSPACK",
    providerLabel: "پارس‌پک",
    regionCode: "ir-thr-1",
    countryCode: "IR",
    deliveryModes: ["RAW"],
    vcpu: 4,
    ramGb: 8,
    storageGb: 80,
    salePriceRial: 10_000_000,
    available: true,
    supportsBackup: true,
    supportsResize: true,
    reliabilityScore: 88,
    capturedAt: new Date("2026-07-28T11:59:00.000Z"),
    expiresAt: new Date("2026-07-28T12:10:00.000Z"),
    ...overrides,
  };
}

test("stale and unavailable offers are hard-filtered before scoring", () => {
  const result = rankProviderOffers(
    profile,
    [
      offer({ id: "valid" }),
      offer({ id: "expired", expiresAt: new Date("2026-07-28T11:59:59.000Z") }),
      offer({ id: "unavailable", available: false }),
    ],
    now,
  );

  assert.deepEqual(result.ranked.map((item) => item.id), ["valid"]);
  assert.deepEqual(
    result.rejected.map((item) => [item.offer.id, item.reason]),
    [
      ["expired", "expired"],
      ["unavailable", "unavailable"],
    ],
  );
});

test("insufficient resources never win because of a lower price", () => {
  const result = rankProviderOffers(
    profile,
    [
      offer({ id: "too-small", vcpu: 2, ramGb: 4, salePriceRial: 1_000_000 }),
      offer({ id: "fit", salePriceRial: 12_000_000 }),
    ],
    now,
  );

  assert.deepEqual(result.ranked.map((item) => item.id), ["fit"]);
  assert.equal(result.rejected[0].reason, "insufficient_resources");
});

test("daily backup is a hard requirement while weekly backup stays a visible preference", () => {
  const withoutBackup = offer({ id: "without-backup", supportsBackup: false });
  const weekly = rankProviderOffers(
    { ...profile, backupPolicy: "WEEKLY" },
    [withoutBackup],
    now,
  );
  const daily = rankProviderOffers(
    { ...profile, backupPolicy: "DAILY" },
    [withoutBackup],
    now,
  );

  assert.equal(weekly.ranked[0]?.id, "without-backup");
  assert.ok(weekly.ranked[0].scoreBreakdown.capability < 100);
  assert.equal(daily.ranked.length, 0);
  assert.equal(daily.rejected[0]?.reason, "missing_backup");
});

test("a cheap but unreliable offer does not automatically beat a healthy offer", () => {
  const result = rankProviderOffers(
    profile,
    [
      offer({
        id: "cheap-risky",
        salePriceRial: 8_000_000,
        reliabilityScore: 5,
        supportsResize: false,
      }),
      offer({
        id: "healthy",
        provider: "ARVAN",
        providerLabel: "ابر آروان",
        salePriceRial: 9_000_000,
        reliabilityScore: 98,
      }),
    ],
    now,
  );

  assert.equal(result.ranked[0].id, "healthy");
  assert.equal(result.ranked.length, 1);
  assert.deepEqual(
    result.rejected.map((item) => [item.offer.id, item.reason]),
    [["cheap-risky", "reliability_below_floor"]],
  );
});

test("provider comparison keeps working when one provider is temporarily down", async () => {
  const sources: ProviderOfferSource[] = [
    {
      provider: "PARSPACK",
      async fetchOffers() {
        throw new Error("private provider timeout");
      },
    },
    {
      provider: "ARVAN",
      async fetchOffers() {
        return [
          offer({
            id: "arvan-live",
            provider: "ARVAN",
            providerLabel: "ابر آروان",
          }),
        ];
      },
    },
  ];

  const result = await compareProviderOffers(profile, sources, now);
  assert.equal(result.primary?.id, "arvan-live");
  assert.deepEqual(
    result.providers.map((provider) => [provider.provider, provider.ok, provider.offerCount]),
    [
      ["PARSPACK", false, 0],
      ["ARVAN", true, 1],
    ],
  );
  assert.doesNotMatch(result.providers[0].safeMessage, /timeout|private/i);
});
