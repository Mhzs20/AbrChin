export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const MAX_BUCKETS = 5_000;

/**
 * Minimal in-memory fixed-window rate limiter.
 * Suitable for a single Node process / container replica.
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

export const otpMobileLimiter = new MemoryRateLimiter(5, 15 * 60 * 1000);
export const otpIpLimiter = new MemoryRateLimiter(20, 15 * 60 * 1000);
export const verifyMobileLimiter = new MemoryRateLimiter(15, 15 * 60 * 1000);
export const verifyIpLimiter = new MemoryRateLimiter(40, 15 * 60 * 1000);
export const recommendationQuoteIpLimiter = new MemoryRateLimiter(30, 15 * 60 * 1000);
export const readyServerQuoteIpLimiter = new MemoryRateLimiter(30, 15 * 60 * 1000);
