import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SETTLEMENT_CONTRACT_ID,
  SETTLEMENT_CONTRACT_VERSION,
} from "@/lib/messagego/settlement/amount";

const PINNED_DIGEST =
  "43392f82b465ba2462621ea09b092bd7977994d5b22ea15f616ffbc12601f242";

export const SETTLEMENT_CONTRACT_PIN = {
  contract_id: SETTLEMENT_CONTRACT_ID,
  version: SETTLEMENT_CONTRACT_VERSION,
  json_sha256: PINNED_DIGEST,
  canonical_repository: "Mhzs20/MessageGo",
  canonical_path: "contracts/integrations/messagego-v2-abrchin-settlement.json",
} as const;

export function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readPinnedSettlementLock() {
  const here = dirname(fileURLToPath(import.meta.url));
  const lockPath = resolve(
    here,
    "../../../docs/program/messagego-v2-abrchin-settlement.lock.json",
  );
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
    contract_id: string;
    version: string;
    json_sha256: string;
  };
  if (
    lock.contract_id !== SETTLEMENT_CONTRACT_ID ||
    lock.version !== SETTLEMENT_CONTRACT_VERSION ||
    lock.json_sha256 !== PINNED_DIGEST
  ) {
    throw new Error("AbrChin settlement pin does not match MESSAGEGO-V2-ABRCHIN-SETTLEMENT@2.1.0");
  }
  return { ...lock, pin: PINNED_DIGEST, lockPath };
}

export function siblingCanonicalContractPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(
    here,
    "../../../../MessageGo/contracts/integrations/messagego-v2-abrchin-settlement.json",
  );
}
