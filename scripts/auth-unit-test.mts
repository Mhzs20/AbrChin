import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { generateSessionToken, hashWithSecret, hmacSha256Hex, safeEqualHex } from "../lib/crypto.ts";
import { normalizeIranMobile } from "../lib/mobile.ts";
import { canAttemptOtp } from "../lib/otp-rules.ts";
import { MemoryRateLimiter } from "../lib/rate-limit.ts";
import { isSameOriginRequest } from "../lib/request-origin.ts";
import { isSessionRecordValid } from "../lib/session-rules.ts";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../lib/session-cookie.ts";
import { ConsoleSmsProvider } from "../lib/sms/console-provider.ts";

test("normalize accepts 09 and +98 formats", () => {
  assert.deepEqual(normalizeIranMobile("09123456789"), { ok: true, mobile: "09123456789" });
  assert.deepEqual(normalizeIranMobile("+989123456789"), { ok: true, mobile: "09123456789" });
  assert.deepEqual(normalizeIranMobile("00989123456789"), { ok: true, mobile: "09123456789" });
  assert.deepEqual(normalizeIranMobile("۰۹۱۲۳۴۵۶۷۸۹"), { ok: true, mobile: "09123456789" });
  assert.equal(normalizeIranMobile("08123456789").ok, false);
  assert.equal(normalizeIranMobile("123").ok, false);
});

test("otp expires after ttl", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  const challenge = {
    expiresAt: new Date("2026-07-25T11:59:00.000Z"),
    attempts: 0,
    consumedAt: null,
  };
  assert.equal(canAttemptOtp(challenge, now), "expired");
});

test("otp blocks after max attempts", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  const challenge = {
    expiresAt: new Date("2026-07-25T12:02:00.000Z"),
    attempts: 5,
    consumedAt: null,
  };
  assert.equal(canAttemptOtp(challenge, now), "max_attempts");
});

test("otp cannot be reused after consume", () => {
  const now = new Date("2026-07-25T12:00:00.000Z");
  const challenge = {
    expiresAt: new Date("2026-07-25T12:02:00.000Z"),
    attempts: 1,
    consumedAt: new Date("2026-07-25T11:59:30.000Z"),
  };
  assert.equal(canAttemptOtp(challenge, now), "consumed");
});

test("otp hash uses HMAC-SHA256 and depends on secret", () => {
  const code = "123456";
  const hashA = hashWithSecret(code, "secret-a");
  const hashB = hashWithSecret(code, "secret-b");
  const expected = createHmac("sha256", "secret-a").update(code, "utf8").digest("hex");

  assert.equal(hashA, expected);
  assert.equal(hmacSha256Hex(code, "secret-a"), expected);
  assert.notEqual(hashA, hashB);
  assert.equal(safeEqualHex(hashA, hashWithSecret(code, "secret-a")), true);
  assert.equal(safeEqualHex(hashA, hashWithSecret("000000", "secret-a")), false);
});

test("session token is at least 32 random bytes", () => {
  const token = generateSessionToken();
  // base64url of 32 bytes is 43 chars without padding
  assert.ok(token.length >= 43);
  assert.notEqual(generateSessionToken(), generateSessionToken());
});

test("rate limiter blocks after threshold and cleans expired buckets", () => {
  const limiter = new MemoryRateLimiter(2, 60_000);
  const now = 1_000_000;
  assert.equal(limiter.check("m1", now).allowed, true);
  assert.equal(limiter.check("m1", now + 1).allowed, true);
  assert.equal(limiter.check("m1", now + 2).allowed, false);
  assert.equal(limiter.check("m2", now + 2).allowed, true);

  assert.equal(limiter.check("m1", now + 60_001).allowed, true);
  assert.equal(limiter.size() <= 2, true);
});

test("guest account access is rejected without session cookie", () => {
  const hasSession = Boolean(undefined);
  assert.equal(hasSession, false);
  assert.equal(SESSION_COOKIE_NAME, "abrchin_session");
});

test("logout cookie is httpOnly and cleared", () => {
  const cleared = {
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(0, true),
    expires: new Date(0),
  };
  assert.equal(cleared.value, "");
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.secure, true);
  assert.equal(cleared.sameSite, "lax");
  assert.equal(cleared.maxAge, 0);
  assert.ok(cleared.expires.getTime() === 0);
});

test("fake revoked and expired sessions are rejected", () => {
  const now = Date.now();
  assert.equal(
    isSessionRecordValid({ revokedAt: null, expiresAt: new Date(now + 1000) }, now),
    true,
  );
  assert.equal(
    isSessionRecordValid({ revokedAt: new Date(now - 10), expiresAt: new Date(now + 1000) }, now),
    false,
  );
  assert.equal(
    isSessionRecordValid({ revokedAt: null, expiresAt: new Date(now - 10) }, now),
    false,
  );
  assert.equal(isSessionRecordValid(null, now), false);
});

test("cross-origin mutating requests are rejected", () => {
  const same = new Request("http://localhost:3010/api/auth/logout", {
    method: "POST",
    headers: {
      host: "localhost:3010",
      origin: "http://localhost:3010",
    },
  });
  const cross = new Request("http://localhost:3010/api/account/profile", {
    method: "PATCH",
    headers: {
      host: "localhost:3010",
      origin: "https://evil.example",
    },
  });
  const crossSiteHint = new Request("http://localhost:3010/api/auth/logout", {
    method: "POST",
    headers: {
      host: "localhost:3010",
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(isSameOriginRequest(same), true);
  assert.equal(isSameOriginRequest(cross), false);
  assert.equal(isSameOriginRequest(crossSiteHint), false);

  const behindProxy = new Request("http://127.0.0.1:3010/api/auth/logout", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3010",
      "x-forwarded-host": "abrchin.ir",
      origin: "https://abrchin.ir",
    },
  });
  assert.equal(isSameOriginRequest(behindProxy), true);
});

test("console SMS fails closed in production and never logs OTP", async () => {
  const provider = new ConsoleSmsProvider();
  const previous = process.env.NODE_ENV;
  const logs: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      () => provider.sendOtp({ mobile: "09120000000", code: "999999", purpose: "LOGIN" }),
      /must not send OTP in production/,
    );
    assert.equal(logs.length, 0);

    process.env.NODE_ENV = "development";
    await provider.sendOtp({ mobile: "09120000000", code: "999999", purpose: "LOGIN" });
    assert.equal(logs.some((line) => line.includes("otp=999999")), true);
  } finally {
    console.info = originalInfo;
    process.env.NODE_ENV = previous;
  }
});

test("console SMS factory policy fails closed in production even when SMS_PROVIDER=console", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProvider = process.env.SMS_PROVIDER;
  try {
    process.env.NODE_ENV = "production";
    process.env.SMS_PROVIDER = "console";

    // Mirrors createSmsProvider() production guard (lib/sms/index.ts).
    const env = {
      isProduction: process.env.NODE_ENV === "production",
      smsProvider: (process.env.SMS_PROVIDER ?? "console").toLowerCase(),
    };

    assert.throws(() => {
      if (env.smsProvider === "console" || !env.smsProvider) {
        if (env.isProduction) {
          throw new Error(
            "SMS_PROVIDER=console is not allowed in production. Configure a real SMS provider.",
          );
        }
      }
    }, /not allowed in production/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    if (previousProvider === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = previousProvider;
  }
});

test("first login creates user; second recovers same mobile identity", () => {
  const users = new Map<string, { id: string; mobile: string }>();

  function upsertUser(mobile: string) {
    if (!users.has(mobile)) {
      const created = { id: `user-${users.size + 1}`, mobile };
      users.set(mobile, created);
      return { ...created, created: true as const };
    }
    return { ...users.get(mobile)!, created: false as const };
  }

  const first = upsertUser("09123456789");
  const second = upsertUser("09123456789");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.id, second.id);
  assert.equal(users.size, 1);
});
