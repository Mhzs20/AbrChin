import { prisma } from "@/lib/db";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const MAX_BUCKETS = 5_000;
const PG_MAX_BUCKETS = 50_000;
const PG_CLEANUP_EVERY = 64;

/**
 * Minimal in-memory fixed-window rate limiter.
 * Suitable for a single Node process / container replica.
 * Keep for non-critical paths; OTP uses PostgresRateLimiter.
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  check(key: string, now = Date.now()): RateLimitResult {
    this.prune(now);
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  size() {
    return this.buckets.size;
  }

  /** Test helper */
  reset() {
    this.buckets.clear();
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    if (this.buckets.size <= MAX_BUCKETS) {
      return;
    }

    const overflow = this.buckets.size - MAX_BUCKETS;
    const sorted = [...this.buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < overflow; i += 1) {
      this.buckets.delete(sorted[i][0]);
    }
  }
}

type RateLimitRow = {
  count: number;
  expiresAt: Date;
};

/**
 * PostgreSQL-backed fixed-window rate limiter.
 * Atomic under concurrent requests, restart-safe, multi-replica safe.
 */
export class PostgresRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private checksSinceCleanup = 0;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  async check(key: string, now = new Date()): Promise<RateLimitResult> {
    const expiresAt = new Date(now.getTime() + this.windowMs);
    const rows = await prisma.$queryRaw<RateLimitRow[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStartAt", "expiresAt", "updatedAt")
      VALUES (${key}, 1, ${now}, ${expiresAt}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "windowStartAt" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${now}
          ELSE "RateLimitBucket"."windowStartAt"
        END,
        "expiresAt" = CASE
          WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt}
          ELSE "RateLimitBucket"."expiresAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "expiresAt"
    `;

    const row = rows[0];
    if (!row) {
      return { allowed: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
    }

    void this.maybeCleanup(now);

    if (row.count > this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000),
        ),
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Test helper — clears buckets for this limiter's key prefix when provided. */
  async reset(keyPrefix?: string) {
    if (keyPrefix) {
      await prisma.$executeRaw`
        DELETE FROM "RateLimitBucket" WHERE "key" LIKE ${`${keyPrefix}%`}
      `;
      return;
    }
    await prisma.rateLimitBucket.deleteMany();
  }

  private async maybeCleanup(now: Date) {
    this.checksSinceCleanup += 1;
    if (this.checksSinceCleanup < PG_CLEANUP_EVERY) return;
    this.checksSinceCleanup = 0;
    try {
      await prisma.rateLimitBucket.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      const count = await prisma.rateLimitBucket.count();
      if (count <= PG_MAX_BUCKETS) return;
      const overflow = count - PG_MAX_BUCKETS;
      const oldest = await prisma.rateLimitBucket.findMany({
        orderBy: { expiresAt: "asc" },
        take: overflow,
        select: { key: true },
      });
      if (oldest.length > 0) {
        await prisma.rateLimitBucket.deleteMany({
          where: { key: { in: oldest.map((row) => row.key) } },
        });
      }
    } catch {
      // Cleanup is best-effort; rate limiting must not fail closed on prune errors.
    }
  }
}

const OTP_WINDOW_MS = 15 * 60 * 1000;

export const otpMobileLimiter = new PostgresRateLimiter(5, OTP_WINDOW_MS);
export const otpIpLimiter = new PostgresRateLimiter(20, OTP_WINDOW_MS);
export const verifyMobileLimiter = new PostgresRateLimiter(15, OTP_WINDOW_MS);
export const verifyIpLimiter = new PostgresRateLimiter(40, OTP_WINDOW_MS);

export const recommendationQuoteIpLimiter = new MemoryRateLimiter(30, OTP_WINDOW_MS);
export const readyServerQuoteIpLimiter = new MemoryRateLimiter(30, OTP_WINDOW_MS);
// A credential is one-time by design; this secondary gate throttles probing
// attempts before the protected reveal path is reached.
export const credentialRevealLimiter = new MemoryRateLimiter(5, OTP_WINDOW_MS);
export const adminCredentialRevealLimiter = new MemoryRateLimiter(10, OTP_WINDOW_MS);
