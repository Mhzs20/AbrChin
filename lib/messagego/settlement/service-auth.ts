import { createHash, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/env";
import { SettlementError } from "@/lib/messagego/settlement/amount";

const CALLER_HEADER = "x-messagego-caller-service-id";

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function secretsEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

export function authenticateSettlementRequest(request: Request): {
  callerServiceId: string;
} {
  const env = getEnv();
  if (env.isProduction) {
    throw new SettlementError(
      "production_denied",
      "MessageGo V2 settlement runtime is denied in production",
    );
  }
  if (request.headers.get("cookie")) {
    throw new SettlementError(
      "browser_forbidden",
      "Settlement is private server-to-server and is not callable by a browser",
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
  if (env.isProduction) return false;
  return env.messageGoSettlementServiceCredential.length >= 32;
}
