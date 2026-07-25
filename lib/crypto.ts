import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 hex digest with a server-side secret/pepper. */
export function hmacSha256Hex(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function hashWithSecret(value: string, secret: string): string {
  return hmacSha256Hex(value, secret);
}

export function generateOtpCode(): string {
  const number = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(number).padStart(6, "0");
}

/** Opaque session token; at least 32 random bytes. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Timing-safe comparison of hex-encoded digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length === 0 || left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}
