import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("Launch V2 runbooks describe only the PREPAID public golden path", async () => {
  const [contract, runbook, founder] = await Promise.all([
    source("docs/launch/launch-contract-v2.md"),
    source("docs/launch-runbook.md"),
    source("docs/phase-1-founder-checklist.md"),
  ]);
  for (const document of [contract, runbook, founder]) {
    assert.match(document, /PREPAID/);
    assert.match(document, /PUBLIC_SALE_ENABLED=true/);
    assert.doesNotMatch(document, /PARCHIN_OPERATIONAL_EVIDENCE_APPROVED/);
  }
  assert.match(runbook, /\/cloud-servers/);
  assert.match(runbook, /Provider mutation برای Launch دستی/);
  assert.match(founder, /Quote پیش از Login/);
  assert.match(founder, /دو Approval/);
  assert.doesNotMatch(runbook, /Customer PAYG requests|### ۴\. Cloud PAYG/);
  assert.doesNotMatch(founder, /سناریوی کنترل‌شده Cloud PAYG/);
});

test("release readiness is explicitly NO-GO with owned external evidence gates", async () => {
  const release = await source("docs/launch/release-readiness-v2.md");
  assert.match(release, /Verdict: `NO-GO` برای Deploy Production/);
  assert.match(release, /Public Sale: \*\*تأیید Founder و پیش‌فرض باز/);
  for (const blocker of [
    "Commit/Push/Draft PR",
    "ظرفیت انسانی عملیات",
    "PostgreSQL واقعی Staging",
    "Staging purchase واقعی PREPAID",
    "داده حقوقی",
    "Production smoke",
    "مجوز Deploy",
  ]) {
    assert.match(release, new RegExp(blocker));
  }
  assert.match(release, /\| Blocker \| Owner \| Due \| Evidence لازم \| وضعیت \|/);
  assert.match(release, /`IN_PROGRESS` — Commit محلی آماده است/);
});

test("production templates keep public sale open and mutations fail closed", async () => {
  const [development, production, compose, policy] =
    await Promise.all([
      source(".env.example"),
      source(".env.production.example"),
      source("compose.production.yaml"),
      source("lib/infrastructure/public-sale-policy.ts"),
    ]);
  for (const key of [
    "PUBLIC_SALE_ENABLED",
    "PARSPACK_PUBLIC_SALE_ENABLED",
    "ARVAN_PUBLIC_SALE_ENABLED",
    "ARVAN_READY_PUBLIC_SALE_ENABLED",
    "ARVAN_CLOUD_PUBLIC_SALE_ENABLED",
    "MANUAL_READY_PUBLIC_SALE_ENABLED",
  ]) {
    assert.match(development, new RegExp(`^${key}=true$`, "m"));
    assert.match(production, new RegExp(`^${key}=true$`, "m"));
    assert.ok(compose.includes(`${key}: \${${key}:-true}`));
  }
  for (const key of [
    "PARSPACK_MUTATIONS_ENABLED",
    "ARVAN_MUTATIONS_ENABLED",
  ]) {
    assert.match(development, new RegExp(`^${key}=false$`, "m"));
    assert.match(production, new RegExp(`^${key}=false$`, "m"));
    assert.ok(compose.includes(`${key}: \${${key}:-false}`));
  }
  assert.doesNotMatch(policy, /parchin_evidence_incomplete/);
  assert.match(policy, /!env\.publicSaleEnabled/);
});
