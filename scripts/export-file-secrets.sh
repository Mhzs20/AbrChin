#!/bin/sh
# Export file-backed secrets into the process environment for Prisma CLI
# and entrypoints. Never print secret values.
abrchin_export_file_secret() {
  env_name="$1"
  file_name="$2"
  file_path="$(printenv "$file_name" 2>/dev/null || true)"
  current="$(printenv "$env_name" 2>/dev/null || true)"
  require="${ABRCHIN_REQUIRE_FILE_SECRETS:-false}"
  case "$require" in
    1|true|TRUE|yes|YES)
      if [ -n "$current" ]; then
        echo "[abrchin] ERROR: $env_name must not be set in the container environment; use $file_name" >&2
        exit 1
      fi
      if [ -z "$file_path" ]; then
        echo "[abrchin] ERROR: $file_name is required when ABRCHIN_REQUIRE_FILE_SECRETS=true" >&2
        exit 1
      fi
      ;;
  esac
  if [ -z "$file_path" ]; then
    return 0
  fi
  if [ ! -f "$file_path" ]; then
    echo "[abrchin] ERROR: secret file missing for $file_name" >&2
    exit 1
  fi
  value="$(tr -d '\r\n' < "$file_path")"
  if [ -z "$value" ]; then
    echo "[abrchin] ERROR: secret file empty for $file_name" >&2
    exit 1
  fi
  export "$env_name=$value"
}

abrchin_export_runtime_secrets() {
  abrchin_export_file_secret DATABASE_URL DATABASE_URL_FILE
  abrchin_export_file_secret SESSION_SECRET SESSION_SECRET_FILE
  abrchin_export_file_secret CREDENTIAL_ENCRYPTION_KEY CREDENTIAL_ENCRYPTION_KEY_FILE
  abrchin_export_file_secret KAVENEGAR_API_KEY KAVENEGAR_API_KEY_FILE
  abrchin_export_file_secret ARVAN_API_KEY ARVAN_API_KEY_FILE
  abrchin_export_file_secret MESSAGEGO_CLIENT_SECRET MESSAGEGO_CLIENT_SECRET_FILE
  abrchin_export_file_secret SMTP_PASSWORD SMTP_PASSWORD_FILE
}
