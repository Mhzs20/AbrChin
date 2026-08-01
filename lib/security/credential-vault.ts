import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { assertCredentialEncryptionKey } from "@/lib/env";

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function decodeKey(encodedKey: string): Buffer {
  const trimmed = encodedKey.trim();
  const key = /^[a-f\d]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptCredential(
  plaintext: string,
  encodedKey = assertCredentialEncryptionKey(),
): EncryptedCredential {
  if (!plaintext || plaintext.length > 4_096) {
    throw new Error("invalid_credential_plaintext");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(encodedKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  encodedKey = assertCredentialEncryptionKey(),
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(encodedKey),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * A non-reversible, keyed fingerprint used only to prevent credential reuse.
 * It intentionally reuses the configured credential key and never persists the
 * plaintext. Encryption remains AES-256-GCM through encryptCredential().
 */
export function credentialFingerprint(
  plaintext: string,
  encodedKey = assertCredentialEncryptionKey(),
) {
  if (!plaintext || plaintext.length > 4_096) {
    throw new Error("invalid_credential_plaintext");
  }
  return createHmac("sha256", decodeKey(encodedKey))
    .update(plaintext, "utf8")
    .digest("hex");
}
