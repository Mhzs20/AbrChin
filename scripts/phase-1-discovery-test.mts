import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRecommendation } from "../lib/recommendation/engine.ts";

const sharedAnswers = {
  audience: "iran" as const,
  stage: "active" as const,
  usage: "daily" as const,
  criticality: "medium" as const,
  management: "managed" as const,
};

test("project choice materially changes the recommendation profile", () => {
  const site = buildRecommendation({ project: "site", ...sharedAnswers });
  const commerce = buildRecommendation({
    project: "commerce",
    ...sharedAnswers,
  });
  const data = buildRecommendation({ project: "data", ...sharedAnswers });

  assert.notDeepEqual(site.profile, commerce.profile);
  assert.notDeepEqual(commerce.profile, data.profile);
  assert.ok(commerce.profile.vcpu > site.profile.vcpu);
  assert.ok(data.profile.storageGb > commerce.profile.storageGb);
  assert.notEqual(site.workloadLabel, commerce.workloadLabel);
});

test("home and solution discovery persist project intent through Compass", async () => {
  const [starter, solutions, compassPage, builder, sessionRoute, service] =
    await Promise.all([
      readFile("components/home-starter.tsx", "utf8"),
      readFile("components/solutions-explorer.tsx", "utf8"),
      readFile("app/compass/page.tsx", "utf8"),
      readFile("components/conversation-builder.tsx", "utf8"),
      readFile("app/api/recommendations/sessions/route.ts", "utf8"),
      readFile("lib/recommendation/session-service.ts", "utf8"),
    ]);

  assert.match(starter, /`\/compass\?project=\$\{selected\}`/);
  assert.match(solutions, /`\/compass\?project=\$\{solution\.id\}`/);
  assert.match(compassPage, /projects\.has\(rawProject as ProjectKind\)/);
  assert.match(builder, /project: initialProject/);
  assert.match(builder, /setShowUnderstanding\(Boolean\(initialProject\)\)/);
  assert.match(sessionRoute, /createConversationSession\(user\?\.id \?\? null, \{/);
  assert.match(service, /Pick<RecommendationAnswers, "project" \| "management">/);
  assert.match(service, /answerSources/);
});

test("Compass explains the recommendation and catalog exposes launch essentials", async () => {
  const [builder, catalog, cloudPage] = await Promise.all([
    readFile("components/conversation-builder.tsx", "utf8"),
    readFile("components/chinish-cloud-catalog.tsx", "utf8"),
    readFile("app/cloud-servers/page.tsx", "utf8"),
  ]);

  assert.match(builder, /چرا این پیشنهاد/);
  assert.match(builder, /recommendation\.reasons/);
  assert.match(builder, /recommendation\.assumptions/);
  assert.match(builder, /پردازنده/);
  assert.match(builder, /حافظه/);
  assert.match(builder, /فضای اولیه/);
  assert.match(builder, /حداقل پیشنهادی/);
  assert.match(catalog, /مبلغ یک ماه سرور/);
  assert.match(catalog, /لوکیشن ایران/);
  assert.match(catalog, /لوکیشن بین‌المللی/);
  assert.match(catalog, /جزئیات خدمات/);
  assert.doesNotMatch(catalog, /معادل تقریبی ساعتی|معادل تقریبی روزانه/);
  assert.match(cloudPage, /۱ \/ ۳ \/ ۶ \/ ۱۲ ماهه/);
});
