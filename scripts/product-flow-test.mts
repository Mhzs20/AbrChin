import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductFlowTransition,
  canTransitionProductFlow,
  nextProductFlowStates,
  productFlowStates,
} from "../lib/product-flow/state-machine.ts";
import { parseRecommendationInput } from "../lib/recommendation/input.ts";
import { getRecommendationQuestionOrder } from "../lib/recommendation/questions.ts";
import { derivePlatformReadinessStatus } from "../lib/monitoring/readiness.ts";

test("product flow covers discovery, quote, provisioning recovery, and lifecycle", () => {
  assert.equal(new Set(productFlowStates).size, productFlowStates.length);
  assert.equal(
    canTransitionProductFlow("DRAFT", "UNDERSTANDING_CONFIRMED"),
    true,
  );
  assert.equal(
    canTransitionProductFlow("DELIVERY_CONFIGURED", "QUOTED"),
    true,
  );
  assert.equal(
    canTransitionProductFlow("PROVISIONING", "PROVISIONING_RECONCILING"),
    true,
  );
  assert.equal(
    canTransitionProductFlow("PROVISIONING_RECONCILING", "HEALTH_CHECKING"),
    true,
  );
  assert.equal(canTransitionProductFlow("DELIVERED", "ACTIVE"), true);
  assert.equal(canTransitionProductFlow("PAID", "AWAITING_PAYMENT"), false);
  assert.deepEqual(nextProductFlowStates("ACTIVE"), []);
});

test("invalid product flow transitions fail closed", () => {
  assert.throws(
    () =>
      assertProductFlowTransition(
        "PAYMENT_PENDING" as never,
        "ACTIVE",
      ),
    /invalid_product_flow_transition:PAYMENT_PENDING:ACTIVE/,
  );
});

test("recommendation input requires every decision answer and normalizes sources", () => {
  const parsed = parseRecommendationInput({
    answers: {
      project: "commerce",
      audience: "iran",
      stage: "launch",
      usage: "daily",
      architecture: "app_db",
      growth: "campaign",
      criticality: "high",
      management: "managed",
    },
    sources: {
      project: "user",
      usage: "estimate",
    },
  });

  assert.equal(parsed.answers.project, "commerce");
  assert.equal(parsed.sources.project, "user");
  assert.equal(parsed.sources.usage, "estimate");
  assert.equal(parsed.sources.management, "user");

  assert.throws(
    () =>
      parseRecommendationInput({
        answers: {
          project: "commerce",
        },
      }),
    /invalid_recommendation_answer:stage/,
  );
  assert.throws(
    () =>
      parseRecommendationInput({
        answers: {
          project: "site",
          stage: "idea",
          usage: "light",
          criticality: "low",
          architecture: "single",
          management: "raw",
        },
      }),
    /invalid_recommendation_answer:management/,
  );
});

test("conversation questions branch only when the workload needs them", () => {
  const simple = getRecommendationQuestionOrder({
    project: "site",
    stage: "idea",
    usage: "light",
  });
  assert.equal(simple.length, 5);
  assert.equal(simple.includes("storage"), false);
  assert.equal(simple.includes("growth"), false);
  assert.equal(simple.includes("downtime"), false);
  assert.equal(simple.includes("architecture"), true);

  const migration = getRecommendationQuestionOrder({
    project: "migration",
    stage: "migration",
    usage: "daily",
    architecture: "app_db",
  });
  assert.equal(migration.length, 5);
  assert.equal(migration.includes("storage"), false);
  assert.equal(migration.includes("growth"), false);
  assert.equal(migration.includes("downtime"), true);
});

test("platform readiness fails closed for database and worker outages", () => {
  assert.equal(
    derivePlatformReadinessStatus("healthy", "healthy"),
    "operational",
  );
  assert.equal(derivePlatformReadinessStatus("healthy", "stale"), "degraded");
  assert.equal(derivePlatformReadinessStatus("healthy", "unknown"), "degraded");
  assert.equal(derivePlatformReadinessStatus("healthy", "down"), "outage");
  assert.equal(
    derivePlatformReadinessStatus("healthy", "down", "stale", "stale"),
    "outage",
  );
  assert.equal(derivePlatformReadinessStatus("down", "healthy"), "outage");
  assert.equal(
    derivePlatformReadinessStatus("healthy", "healthy", "healthy", "stale"),
    "degraded",
  );
});
