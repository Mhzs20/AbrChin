import { createHash, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/env";
import { SettlementError } from "@/lib/messagego/settlement/amount";
import {
  boundSkewSeconds,
  compareSignature,
  DIRECTION_MESSAGEGO_TO_ABRCHIN,
  loadKeyringFile,
  parseHeaders,
  sign,
  S2SError,
  verificationKey,
} from "@/lib/messagego/s2s/hmac";
import { claimS2SReplay } from "@/lib/messagego/s2s/replay";

const CALLER_HEADER = "x-messagego-caller-service-id";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function secretsEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function hasHmacHeaders(request: Request) {
  return Boolean(request.headers.get("X-MessageGo-S2S-Signature"));
}

function hmacConfigured() {
  const env = getEnv();
  return env.messageGoS2SKeyringFile.length > 0;
}

export async function authenticateSettlementRequest(
  request: Request,
  rawBody: Uint8Array = new Uint8Array(),
): Promise<{ callerServiceId: string }> {
  const env = getEnv();
  if (request.headers.get("cookie")) {
    throw new SettlementError(
      "browser_forbidden",
      "Settlement is private server-to-server and is not callable by a browser",
    );
  }
  if (env.isProduction && !env.messageGoSettlementEnabled) {
    throw new SettlementError(
      "production_denied",
      "MessageGo settlement runtime is denied in production",
    );
  }

  if (hasHmacHeaders(request)) {
    if (!hmacConfigured()) {
      throw new SettlementError(
        "settlement_runtime_unavailable",
        "Settlement HMAC keyring is not configured; fail closed",
      );
    }
    try {
      const ring = loadKeyringFile(env.messageGoS2SKeyringFile);
      const url = new URL(request.url);
      const parsed = parseHeaders(
        request.headers,
        request.method,
        url.pathname,
        url.search.replace(/^\?/, ""),
        Buffer.from(rawBody),
      );
      if (
        parsed.fields.contractId !== "MESSAGEGO-V2-ABRCHIN-SETTLEMENT" ||
        parsed.fields.contractVersion !== "2.0.0"
      ) {
        throw new S2SError("unauthenticated", "contract identity");
      }
      const allowed = env.messageGoS2SAllowedServiceIds;
      if (allowed.length > 0 && !allowed.includes(parsed.fields.serviceId)) {
        throw new S2SError("unauthenticated", "service_id");
      }
      const skew = boundSkewSeconds(env.messageGoS2SMaxClockSkewSeconds);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parsed.fields.timestampUnix) > skew) {
        throw new S2SError("clock_skew", "s2s timestamp outside allowed skew");
      }
      const key = verificationKey(
        ring,
        parsed.fields.keyId,
        DIRECTION_MESSAGEGO_TO_ABRCHIN,
      );
      const expected = sign(key.secret, parsed.fields);
      if (!compareSignature(expected, parsed.signature)) {
        throw new S2SError("unauthenticated", "signature");
      }
      await claimS2SReplay({
        serviceId: parsed.fields.serviceId,
        keyId: parsed.fields.keyId,
        nonce: parsed.fields.nonce,
        expiresAt: new Date((parsed.fields.timestampUnix + skew) * 1000),
      });
      return { callerServiceId: parsed.fields.serviceId };
    } catch (error) {
      if (error instanceof SettlementError) throw error;
      if (error instanceof S2SError) {
        const mapped =
          error.code === "replay"
            ? "unauthenticated"
            : error.code === "clock_skew"
              ? "unauthenticated"
              : "unauthenticated";
        throw new SettlementError(mapped, error.message);
      }
      throw new SettlementError("unauthenticated", "Settlement service identity is invalid");
    }
  }

  if (env.isProduction && env.messageGoSettlementEnabled) {
    throw new SettlementError(
      "unauthenticated",
      "HMAC S2S authentication is required when MessageGo settlement is enabled in production",
    );
  }

  const credential = env.messageGoSettlementServiceCredential;
  if (credential.length < 32) {
    throw new SettlementError(
      "settlement_runtime_unavailable",
      "Settlement service credential is not configured; fail closed",
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match || !secretsEqual(match[1], credential)) {
    throw new SettlementError("unauthenticated", "Settlement service identity is invalid");
  }
  const callerServiceId = request.headers.get(CALLER_HEADER)?.trim() ?? "";
  if (!callerServiceId || callerServiceId.length > 128 || /[\r\n\0]/.test(callerServiceId)) {
    throw new SettlementError("invalid_request", "caller_service_id header is required");
  }
  return { callerServiceId };
}

export function settlementRuntimeAllowed() {
  const env = getEnv();
  if (env.isProduction && !env.messageGoSettlementEnabled) return false;
  if (env.isProduction && env.messageGoSettlementEnabled) {
    return hmacConfigured();
  }
  return env.messageGoSettlementServiceCredential.length >= 32 || hmacConfigured();
}
