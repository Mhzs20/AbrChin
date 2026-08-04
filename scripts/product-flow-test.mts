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
      budget: "2m_5m",
      stack: "wordpress",
      domainReady: "yes",
      dataResidency: "iran_only",
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
          management: "not-a-real-choice",
        },
      }),
    /invalid_recommendation_answer:management/,
  );
  const withSelfManage = parseRecommendationInput({
    answers: {
      project: "site",
      stage: "idea",
      usage: "light",
      criticality: "low",
      management: "raw",
      budget: "unknown",
      stack: "unknown",
      domainReady: "unknown",
    },
  });
  assert.equal(withSelfManage.answers.management, "raw");
});

test("conversation questions stay chat-core and branch only for migration", () => {
  const simple = getRecommendationQuestionOrder({
    project: "site",
    stage: "idea",
    usage: "light",
  });
  assert.deepEqual(simple, [
    "project",
    "stage",
    "usage",
    "criticality",
    "management",
    "budget",
    "stack",
    "domainReady",
  ]);
  assert.equal(simple.includes("downtime"), false);

  const migration = getRecommendationQuestionOrder({
    project: "migration",
    stage: "migration",
    usage: "daily",
  });
  assert.deepEqual(migration, [
    "project",
    "stage",
    "downtime",
    "usage",
    "criticality",
    "management",
    "budget",
    "stack",
    "domainReady",
  ]);
});

test("answers API accepts Compass budget/stack questions", async () => {
  const { readFile } = await import("node:fs/promises");
  const [answersRoute, inputSource, quoteSource] = await Promise.all([
    readFile("app/api/recommendations/sessions/[id]/answers/route.ts", "utf8"),
    readFile("lib/recommendation/input.ts", "utf8"),
    readFile("lib/recommendation/quote-service.ts", "utf8"),
  ]);
  assert.match(answersRoute, /isRecommendationQuestionId/);
  assert.doesNotMatch(
    answersRoute,
    /new Set<QuestionId>\(\[\s*"project"/,
  );
  assert.match(inputSource, /budget: \["under_500k"/);
  assert.match(inputSource, /RECOMMENDATION_QUESTION_IDS/);
  assert.match(quoteSource, /supportsBackup: plan\.parchinIncluded === true/);
  assert.match(quoteSource, /always recommend a real catalog server/i);
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
