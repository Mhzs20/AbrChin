import { createHash } from "node:crypto";

import { idempotencyFingerprint } from "@/lib/idempotency";

export function settlementFingerprint(body: unknown): string {
  return idempotencyFingerprint(body);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
