import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustRecommendationProfile,
  buildRecommendation,
} from "../lib/recommendation/engine.ts";

test("balanced recommendation is deterministic for an active commerce workload", () => {
  const recommendation = buildRecommendation({
    project: "commerce",
    audience: "iran",
    stage: "active",
    usage: "daily",
    criticality: "high",
    management: "managed",
  });

  assert.deepEqual(recommendation.profile, {
    vcpu: 8,
    ramGb: 24,
    storageGb: 120,
    regionPreference: "IRAN",
    deliveryMode: "MANAGED",
    backupPolicy: "DAILY",
    needsResize: false,
  });
  assert.equal(recommendation.confidence, "high");
  assert.equal(recommendation.architectureEscalation, false);
  assert.equal(recommendation.assumptions.length, 0);
});

test("unknown answers stay visible as assumptions", () => {
  const recommendation = buildRecommendation({
    project: "site",
    audience: "unknown",
    stage: "idea",
    usage: "unknown",
    criticality: "unknown",
    management: "unknown",
  });

  assert.equal(recommendation.confidence, "low");
  assert.ok(recommendation.assumptions.some((item) => item.field === "audience"));
  assert.ok(recommendation.assumptions.some((item) => item.field === "usage"));
  assert.ok(recommendation.assumptions.some((item) => item.field === "criticality"));
  assert.ok(recommendation.assumptions.some((item) => item.field === "management"));
});

test("severe criticality blocks automatic single-server checkout", () => {
  const recommendation = buildRecommendation({
    project: "api",
    audience: "iran",
    stage: "active",
    usage: "busy",
    criticality: "severe",
    management: "managed",
  });

  assert.equal(recommendation.architectureEscalation, true);
  assert.match(recommendation.caveats[0], /یک سرور/);
});

test("economy adjustment never goes below the workload minimum", () => {
  const recommendation = buildRecommendation({
    project: "data",
    audience: "iran",
    stage: "growing",
    usage: "busy",
    criticality: "medium",
    management: "raw",
  });
  const economy = adjustRecommendationProfile(recommendation, "economy");
  const performance = adjustRecommendationProfile(recommendation, "performance");

  assert.ok(economy.vcpu >= recommendation.minimumProfile.vcpu);
  assert.ok(economy.ramGb >= recommendation.minimumProfile.ramGb);
  assert.ok(economy.storageGb >= recommendation.minimumProfile.storageGb);
  assert.ok(performance.vcpu > recommendation.profile.vcpu);
  assert.ok(performance.ramGb > recommendation.profile.ramGb);
});
