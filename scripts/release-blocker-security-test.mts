import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { PrismaClient, UserRole } from "@prisma/client";

import {
  effectiveUserRole,
  isEligibleAdmin,
} from "../lib/admin/eligibility.ts";
import { MemoryRateLimiter, PostgresRateLimiter } from "../lib/rate-limit.ts";
import { isSameOriginRequest } from "../lib/request-origin.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

test("quote pages do not mutate plans/quotes/wallets on render", async () => {
  const cloud = await readFile("app/cloud-servers/quote/[id]/page.tsx", "utf8");
  const ready = await readFile("app/ready-servers/quote/[id]/page.tsx", "utf8");
  for (const source of [cloud, ready]) {
    assert.doesNotMatch(source, /refreshRecommendationQuote/);
    assert.doesNotMatch(source, /ensureWalletForUser/);
    assert.doesNotMatch(source, /infrastructurePlan\.update/);
    assert.doesNotMatch(source, /PAYG_WALLET/);
    assert.match(source, /getWalletForUser/);
    assert.match(source, /QuoteExpiredRefresh/);
  }
  const refreshCloud = await readFile(
    "app/api/cloud-servers/quotes/[id]/refresh/route.ts",
    "utf8",
  );
  const refreshReady = await readFile(
    "app/api/ready-servers/quotes/[id]/refresh/route.ts",
    "utf8",
  );
  assert.match(refreshCloud, /export async function POST/);
  assert.match(refreshReady, /export async function POST/);
  assert.match(refreshCloud, /refreshRecommendationQuote/);
  assert.doesNotMatch(refreshCloud, /export async function GET/);
});

test("public storefront GET does not ensure/repair sale state", async () => {
  const assortment = await readFile(
    "lib/storefront/assortment-service.ts",
    "utf8",
  );
  const listFn = assortment.slice(
    assortment.indexOf("export async function listPublicStorefrontTiers"),
    assortment.indexOf("function validateSlotBatch"),
  );
  assert.doesNotMatch(listFn, /ensureStorefrontSaleReady/);
  assert.doesNotMatch(listFn, /\.upsert\(/);
  assert.match(listFn, /findUnique/);

  const resolveSlice = assortment.slice(
    assortment.indexOf("async function resolveStorefrontTierOffers"),
    assortment.indexOf("export async function listPublicStorefrontTiers"),
  );
  assert.doesNotMatch(resolveSlice, /publishCatalogItems/);
  assert.doesNotMatch(resolveSlice, /ensurePublishedPlanForCatalogItem/);
});

test("renewal GET is read-only; quote create requires POST", async () => {
  const renew = await readFile(
    "app/api/account/instances/[id]/renew/route.ts",
    "utf8",
  );
  const panel = await readFile(
    "components/account/subscription-panel.tsx",
    "utf8",
  );
  const getStart = renew.indexOf("export async function GET");
  const postStart = renew.indexOf("export async function POST");
  assert.ok(getStart >= 0 && postStart > getStart);
  const getBody = renew.slice(getStart, postStart);
  assert.doesNotMatch(getBody, /createRenewalQuote/);
  assert.doesNotMatch(getBody, /payRenewalQuote/);
  assert.match(renew.slice(postStart), /createRenewalQuote/);
  assert.match(panel, /method:\s*"POST"/);
});

test("wallet GET routes do not ensure/create wallets", async () => {
  for (const path of [
    "app/api/wallet/route.ts",
    "app/api/wallet/transactions/route.ts",
    "app/api/wallet/topups/[id]/route.ts",
  ]) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /ensureWalletForUser/);
    assert.match(source, /getWalletForUser/);
  }
});

test("admin allowlist is source of truth over stale ADMIN role", () => {
  const prior = process.env.ADMIN_MOBILES;
  process.env.ADMIN_MOBILES = "09121111111";
  try {
    const allowed = {
      role: UserRole.ADMIN,
      mobile: "09121111111",
    };
    const stale = {
      role: UserRole.ADMIN,
      mobile: "09122222222",
    };
    const customer = {
      role: UserRole.CUSTOMER,
      mobile: "09123333333",
    };
    assert.equal(isEligibleAdmin(allowed), true);
    assert.equal(isEligibleAdmin(stale), false);
    assert.equal(isEligibleAdmin(customer), false);
    assert.equal(effectiveUserRole(allowed), UserRole.ADMIN);
    assert.equal(effectiveUserRole(stale), UserRole.CUSTOMER);
    assert.equal(effectiveUserRole(customer), UserRole.CUSTOMER);
  } finally {
    if (prior === undefined) delete process.env.ADMIN_MOBILES;
    else process.env.ADMIN_MOBILES = prior;
  }
});

test("guards, session public user, and command actors re-check admin eligibility", async () => {
  const guards = await readFile("lib/auth/guards.ts", "utf8");
  const receipt = await readFile("lib/admin/command-receipt.ts", "utf8");
  const auth = await readFile("lib/auth-service.ts", "utf8");
  const sessionUser = await readFile("lib/session-user.ts", "utf8");
  assert.match(guards, /isEligibleAdmin/);
  assert.match(receipt, /isEligibleAdmin/);
  assert.match(sessionUser, /effectiveUserRole/);
  assert.match(auth, /role: nextRole/);
  assert.match(auth, /UserRole\.CUSTOMER/);
});

test("security headers configured in Next and nginx", async () => {
  const nextConfig = await readFile("next.config.ts", "utf8");
  const nginx = await readFile("ops/nginx/abrchin.conf", "utf8");
  for (const source of [nextConfig, nginx]) {
    assert.match(source, /X-Content-Type-Options/);
    assert.match(source, /Referrer-Policy/);
    assert.match(source, /Permissions-Policy/);
    assert.match(source, /frame-ancestors 'none'|X-Frame-Options/);
    assert.match(source, /Content-Security-Policy/);
  }
  assert.match(nginx, /Strict-Transport-Security/);
  assert.match(nginx, /X-Forwarded-Host \$host/);
  assert.match(nextConfig, /unsafe-inline/);
});

test("forwarded host is not trusted without TRUSTED_PROXY_HOPS", () => {
  const prior = process.env.TRUSTED_PROXY_HOPS;
  process.env.TRUSTED_PROXY_HOPS = "0";
  try {
    const request = new Request("http://127.0.0.1:3010/api/orders", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3010",
        origin: "https://evil.example",
        "x-forwarded-host": "evil.example",
      },
    });
    assert.equal(isSameOriginRequest(request), false);
  } finally {
    if (prior === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = prior;
  }
});

test("admin revoke, blocked user, and stale session eligibility matrix", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const prior = process.env.ADMIN_MOBILES;
  const allowedMobile = "09120000001";
  const revokedMobile = "09120000002";
  const customerMobile = "09120000003";
  const blockedMobile = "09120000004";
  process.env.ADMIN_MOBILES = allowedMobile;
  const mobiles = [allowedMobile, revokedMobile, customerMobile, blockedMobile];
  await prisma.session.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
  await prisma.user.deleteMany({ where: { mobile: { in: mobiles } } });
  t.after(async () => {
    await prisma!.session.deleteMany({ where: { user: { mobile: { in: mobiles } } } });
    await prisma!.user.deleteMany({ where: { mobile: { in: mobiles } } });
    if (prior === undefined) delete process.env.ADMIN_MOBILES;
    else process.env.ADMIN_MOBILES = prior;
  });

  const [allowed, revoked, customer, blocked] = await Promise.all([
    prisma.user.create({
      data: { mobile: allowedMobile, role: UserRole.ADMIN },
    }),
    prisma.user.create({
      data: { mobile: revokedMobile, role: UserRole.ADMIN },
    }),
    prisma.user.create({
      data: { mobile: customerMobile, role: UserRole.CUSTOMER },
    }),
    prisma.user.create({
      data: {
        mobile: blockedMobile,
        role: UserRole.ADMIN,
        accountStatus: "BLOCKED",
        blockedAt: new Date(),
        blockedReason: "test",
      },
    }),
  ]);

  assert.equal(isEligibleAdmin(allowed), true);
  assert.equal(isEligibleAdmin(revoked), false);
  assert.equal(isEligibleAdmin(customer), false);
  // Blocked + stale ADMIN still fails allowlist if not listed; blocked also
  // fails session validity separately in findValidSession.
  assert.equal(isEligibleAdmin(blocked), false);
  assert.equal(effectiveUserRole(revoked), UserRole.CUSTOMER);

  const session = await prisma.session.create({
    data: {
      userId: revoked.id,
      tokenHash: `revoke-test-${Date.now()}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  assert.equal(session.revokedAt, null);
  // Stale session + stale ADMIN role must still resolve as non-admin.
  assert.equal(isEligibleAdmin({ role: UserRole.ADMIN, mobile: revokedMobile }), false);
});

test("memory rate limiter still blocks after threshold", () => {
  const limiter = new MemoryRateLimiter(2, 60_000);
  const now = 2_000_000;
  assert.equal(limiter.check("k", now).allowed, true);
  assert.equal(limiter.check("k", now + 1).allowed, true);
  assert.equal(limiter.check("k", now + 2).allowed, false);
});

test("postgres OTP rate limiter is restart-safe and concurrency-safe", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const limiter = new PostgresRateLimiter(3, 60_000);
  const prefix = `test:otp:${Date.now()}:`;
  await limiter.reset(prefix);
  t.after(async () => {
    await limiter.reset(prefix);
  });

  const key = `${prefix}mobile`;
  assert.equal((await limiter.check(key)).allowed, true);
  assert.equal((await limiter.check(key)).allowed, true);
  assert.equal((await limiter.check(key)).allowed, true);
  assert.equal((await limiter.check(key)).allowed, false);

  // Simulate "new service instance": new limiter object, same DB state.
  const restarted = new PostgresRateLimiter(3, 60_000);
  const blocked = await restarted.check(key);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  const burstKey = `${prefix}burst`;
  const results = await Promise.all(
    Array.from({ length: 20 }, () => limiter.check(burstKey)),
  );
  const allowed = results.filter((result) => result.allowed).length;
  const denied = results.filter((result) => !result.allowed).length;
  assert.equal(allowed, 3);
  assert.equal(denied, 17);

  // Expiry: short window then allow again.
  const short = new PostgresRateLimiter(1, 50);
  const expKey = `${prefix}exp`;
  assert.equal((await short.check(expKey)).allowed, true);
  assert.equal((await short.check(expKey)).allowed, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal((await short.check(expKey)).allowed, true);
});

test("rate limit migration creates RateLimitBucket additively", async () => {
  const migration = await readFile(
    "prisma/migrations/20260807130000_rate_limit_bucket_and_payg_repair/migration.sql",
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "RateLimitBucket"/);
  assert.match(migration, /PREPAID_TERM/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
});
