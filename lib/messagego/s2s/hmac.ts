import "server-only";

import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";

export const S2S_PROTOCOL = "MESSAGEGO-S2S-HMAC-V1";

export const S2S_HEADERS = {
  version: "x-messagego-s2s-version",
  serviceId: "x-messagego-s2s-service-id",
  keyId: "x-messagego-s2s-key-id",
  timestamp: "x-messagego-s2s-timestamp",
  nonce: "x-messagego-s2s-nonce",
  content: "x-messagego-s2s-content-sha256",
  contractId: "x-messagego-s2s-contract-id",
  contractVersion: "x-messagego-s2s-contract-version",
  signature: "x-messagego-s2s-signature",
} as const;

export const DIRECTION_MESSAGEGO_TO_ABRCHIN = "messagego_to_abrchin";
export const DIRECTION_ABRCHIN_TO_MESSAGEGO = "abrchin_to_messagego";

export type S2SDirection =
  | typeof DIRECTION_MESSAGEGO_TO_ABRCHIN
  | typeof DIRECTION_ABRCHIN_TO_MESSAGEGO;

export class S2SError extends Error {
  readonly code:
    | "unauthenticated"
    | "replay"
    | "clock_skew"
    | "invalid_key"
    | "unknown_key"
    | "direction";

  constructor(code: S2SError["code"], message: string) {
    super(message);
    this.name = "S2SError";
    this.code = code;
  }
}

export type S2SKey = {
  keyId: string;
  secret: Buffer;
  direction: S2SDirection;
  status: "active" | "previous" | "revoked";
};

export type S2SKeyring = {
  protocol: string;
  keys: S2SKey[];
};

export type S2SFields = {
  method: string;
  path: string;
  rawQuery: string;
  body: Buffer;
  serviceId: string;
  keyId: string;
  timestampUnix: number;
  nonce: string;
  contractId: string;
  contractVersion: string;
};

function queryEscape(value: string) {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

export function canonicalQuery(rawQuery: string) {
  const raw = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  if (!raw) return "";
  const params = new URLSearchParams(raw);
  const keys = [...new Set([...params.keys()])].sort();
  const parts: string[] = [];
  for (const key of keys) {
    const values = params.getAll(key).sort();
    for (const value of values) {
      parts.push(`${queryEscape(key)}=${queryEscape(value)}`);
    }
  }
  return parts.join("&");
}

export function bodySha256(body: Buffer) {
  return createHash("sha256").update(body).digest("hex");
}

export function canonicalPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function canonicalString(fields: S2SFields) {
  return [
    S2S_PROTOCOL,
    fields.method.toUpperCase().trim(),
    canonicalPath(fields.path),
    canonicalQuery(fields.rawQuery),
    bodySha256(fields.body),
    fields.serviceId.trim(),
    fields.keyId.trim(),
    String(fields.timestampUnix),
    fields.nonce.trim().toLowerCase(),
    fields.contractId.trim(),
    fields.contractVersion.trim(),
  ].join("\n");
}

export function sign(secret: Buffer, fields: S2SFields) {
  if (secret.length < 32) {
    throw new S2SError("invalid_key", "HMAC secret shorter than 32 bytes");
  }
  return createHmac("sha256", secret).update(canonicalString(fields)).digest("hex");
}

export function compareSignature(left: string, right: string) {
  try {
    const a = Buffer.from(left.trim(), "hex");
    const b = Buffer.from(right.trim(), "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function randomNonce() {
  return randomBytes(16).toString("hex");
}

function decodeSecret(b64: string, hexSecret: string) {
  let secret: Buffer;
  if (b64.trim()) secret = Buffer.from(b64.trim(), "base64");
  else if (hexSecret.trim()) secret = Buffer.from(hexSecret.trim(), "hex");
  else throw new S2SError("invalid_key", "missing secret material");
  if (secret.length < 32) {
    throw new S2SError("invalid_key", "secret shorter than 32 bytes");
  }
  return secret;
}

export function parseKeyringJSON(raw: string | Buffer): S2SKeyring {
  const parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as {
    protocol?: string;
    keys?: Array<{
      key_id?: string;
      secret_b64?: string;
      secret_hex?: string;
      direction?: string;
      status?: string;
    }>;
  };
  if (parsed.protocol && parsed.protocol !== S2S_PROTOCOL) {
    throw new S2SError("invalid_key", "unexpected protocol");
  }
  const keys: S2SKey[] = [];
  const seen = new Set<string>();
  for (const item of parsed.keys ?? []) {
    const keyId = (item.key_id ?? "").trim();
    const direction = (item.direction ?? "").trim() as S2SDirection;
    if (!keyId) throw new S2SError("invalid_key", "key_id required");
    if (seen.has(keyId)) throw new S2SError("invalid_key", "duplicate key_id");
    seen.add(keyId);
    if (
      direction !== DIRECTION_MESSAGEGO_TO_ABRCHIN &&
      direction !== DIRECTION_ABRCHIN_TO_MESSAGEGO
    ) {
      throw new S2SError("invalid_key", "direction");
    }
    const status = ((item.status ?? "active").trim() || "active") as S2SKey["status"];
    keys.push({
      keyId,
      secret: decodeSecret(item.secret_b64 ?? "", item.secret_hex ?? ""),
      direction,
      status,
    });
  }
  if (keys.length === 0) throw new S2SError("invalid_key", "empty keyring");
  return { protocol: S2S_PROTOCOL, keys };
}

export function loadKeyringFile(path: string): S2SKeyring {
  if (!path.startsWith("/")) {
    throw new S2SError("invalid_key", "keyring path must be absolute");
  }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new S2SError("invalid_key", "keyring must be a regular non-symlink file");
  }
  if ((info.mode & 0o077) !== 0) {
    throw new S2SError("invalid_key", "keyring permissions must deny group and other access");
  }
  return parseKeyringJSON(readFileSync(path));
}

export function activeSigner(ring: S2SKeyring, direction: S2SDirection) {
  const matches = ring.keys.filter((key) => key.direction === direction && key.status === "active");
  if (matches.length !== 1) {
    throw new S2SError("invalid_key", "exactly one active signing key is required");
  }
  return matches[0];
}

export function verificationKey(ring: S2SKeyring, keyId: string, direction: S2SDirection) {
  const key = ring.keys.find((item) => item.keyId === keyId);
  if (!key) throw new S2SError("unknown_key", "s2s key_id is unknown or revoked");
  if (key.direction !== direction) throw new S2SError("direction", "s2s key direction mismatch");
  if (key.status === "revoked" || (key.status !== "active" && key.status !== "previous")) {
    throw new S2SError("unknown_key", "s2s key_id is unknown or revoked");
  }
  return key;
}

export function boundSkewSeconds(value: number) {
  if (!Number.isFinite(value) || value < 30) return 30;
  if (value > 600) return 600;
  return Math.trunc(value);
}

export function applyHeaders(headers: Headers, fields: S2SFields, signature: string) {
  headers.set("X-MessageGo-S2S-Version", S2S_PROTOCOL);
  headers.set("X-MessageGo-S2S-Service-Id", fields.serviceId);
  headers.set("X-MessageGo-S2S-Key-Id", fields.keyId);
  headers.set("X-MessageGo-S2S-Timestamp", String(fields.timestampUnix));
  headers.set("X-MessageGo-S2S-Nonce", fields.nonce);
  headers.set("X-MessageGo-S2S-Content-SHA256", bodySha256(fields.body));
  headers.set("X-MessageGo-S2S-Contract-Id", fields.contractId);
  headers.set("X-MessageGo-S2S-Contract-Version", fields.contractVersion);
  headers.set("X-MessageGo-S2S-Signature", signature);
}

export function parseHeaders(
  headers: Headers,
  method: string,
  path: string,
  rawQuery: string,
  body: Buffer,
): { fields: S2SFields; signature: string } {
  if ((headers.get("X-MessageGo-S2S-Version") ?? "") !== S2S_PROTOCOL) {
    throw new S2SError("unauthenticated", "protocol version");
  }
  const tsRaw = (headers.get("X-MessageGo-S2S-Timestamp") ?? "").trim();
  const timestampUnix = Number.parseInt(tsRaw, 10);
  if (!Number.isFinite(timestampUnix)) {
    throw new S2SError("unauthenticated", "timestamp");
  }
  const fields: S2SFields = {
    method,
    path,
    rawQuery,
    body,
    serviceId: (headers.get("X-MessageGo-S2S-Service-Id") ?? "").trim(),
    keyId: (headers.get("X-MessageGo-S2S-Key-Id") ?? "").trim(),
    timestampUnix,
    nonce: (headers.get("X-MessageGo-S2S-Nonce") ?? "").trim().toLowerCase(),
    contractId: (headers.get("X-MessageGo-S2S-Contract-Id") ?? "").trim(),
    contractVersion: (headers.get("X-MessageGo-S2S-Contract-Version") ?? "").trim(),
  };
  if (
    !fields.serviceId ||
    !fields.keyId ||
    !fields.nonce ||
    !fields.contractId ||
    !fields.contractVersion
  ) {
    throw new S2SError("unauthenticated", "missing s2s identity fields");
  }
  if ((headers.get("X-MessageGo-S2S-Content-SHA256") ?? "") !== bodySha256(body)) {
    throw new S2SError("unauthenticated", "content hash mismatch");
  }
  return {
    fields,
    signature: (headers.get("X-MessageGo-S2S-Signature") ?? "").trim(),
  };
}

export function signRequest(
  headers: Headers,
  ring: S2SKeyring,
  direction: S2SDirection,
  serviceId: string,
  method: string,
  path: string,
  rawQuery: string,
  body: Buffer,
  contractId: string,
  contractVersion: string,
  now = () => Math.floor(Date.now() / 1000),
) {
  const key = activeSigner(ring, direction);
  const fields: S2SFields = {
    method,
    path,
    rawQuery,
    body,
    serviceId,
    keyId: key.keyId,
    timestampUnix: now(),
    nonce: randomNonce(),
    contractId,
    contractVersion,
  };
  const signature = sign(key.secret, fields);
  applyHeaders(headers, fields, signature);
  return fields;
}
