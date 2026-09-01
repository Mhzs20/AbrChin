import { lstatSync, readFileSync } from "node:fs";

const CORE_SECRETS = [
  ["DATABASE_URL", "DATABASE_URL_FILE"],
  ["SESSION_SECRET", "SESSION_SECRET_FILE"],
  ["CREDENTIAL_ENCRYPTION_KEY", "CREDENTIAL_ENCRYPTION_KEY_FILE"],
] as const;

const OPTIONAL_SECRETS = [
  ["KAVENEGAR_API_KEY", "KAVENEGAR_API_KEY_FILE"],
  ["ARVAN_API_KEY", "ARVAN_API_KEY_FILE"],
  ["MESSAGEGO_CLIENT_SECRET", "MESSAGEGO_CLIENT_SECRET_FILE"],
  ["ZIBAL_MERCHANT", "ZIBAL_MERCHANT_FILE"],
  ["ZARINPAL_MERCHANT_ID", "ZARINPAL_MERCHANT_ID_FILE"],
  ["SMTP_PASSWORD", "SMTP_PASSWORD_FILE"],
] as const;

let loaded = false;

function requireFileSecrets(): boolean {
  const raw = (process.env.ABRCHIN_REQUIRE_FILE_SECRETS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function readSecretFile(path: string): string {
  if (!path.startsWith("/") || path.includes("\0")) {
    throw new Error("secret file path must be absolute");
  }
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("secret file must be a regular non-symlink file");
  }
  const mode = info.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error("secret file permissions must deny group and other access");
  }
  const uidEnv = (process.env.ABRCHIN_SECRET_FILE_UID ?? "").trim();
  const gidEnv = (process.env.ABRCHIN_SECRET_FILE_GID ?? "").trim();
  if (uidEnv !== "") {
    const want = Number.parseInt(uidEnv, 10);
    if (!Number.isInteger(want) || info.uid !== want) {
      throw new Error(`secret file uid ${info.uid} does not match required uid ${uidEnv}`);
    }
  }
  if (gidEnv !== "") {
    const want = Number.parseInt(gidEnv, 10);
    if (!Number.isInteger(want) || info.gid !== want) {
      throw new Error(`secret file gid ${info.gid} does not match required gid ${gidEnv}`);
    }
  }
  if (info.size < 1 || info.size > 16 * 1024) {
    throw new Error("secret file size is invalid");
  }
  const value = readFileSync(path, "utf8").replace(/\r?\n/g, "").trim();
  if (!value) {
    throw new Error("secret file content is invalid");
  }
  return value;
}

export function loadFileSecrets(): void {
  if (loaded) return;
  loaded = true;
  const required = requireFileSecrets();
  for (const [envName, fileName] of [...CORE_SECRETS, ...OPTIONAL_SECRETS]) {
    const filePath = (process.env[fileName] ?? "").trim();
    const envVal = (process.env[envName] ?? "").trim();
    const core = CORE_SECRETS.some(([name]) => name === envName);
    if (required && core) {
      if (envVal) {
        throw new Error(
          `production must not set ${envName} in the container environment; use ${fileName}`,
        );
      }
      if (!filePath) {
        throw new Error(`${fileName} is required when ABRCHIN_REQUIRE_FILE_SECRETS=true`);
      }
    }
    if (!filePath) continue;
    if (envVal) {
      if (required) {
        throw new Error(`${envName} and ${fileName} are mutually exclusive`);
      }
      continue;
    }
    process.env[envName] = readSecretFile(filePath);
  }
}
