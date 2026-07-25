#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

required=(
  ABRCHIN_IMAGE
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  SESSION_SECRET
  SMS_PROVIDER
  PAYMENT_CALLBACK_BASE_URL
)

missing=0
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "[bootstrap] missing required env: $key" >&2
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "[bootstrap] copy .env.production.example and fill secrets before running." >&2
  exit 1
fi

if [[ "${#SESSION_SECRET}" -lt 16 ]]; then
  echo "[bootstrap] SESSION_SECRET is too short" >&2
  exit 1
fi

echo "[bootstrap] starting compose stack"
docker compose -f compose.production.yaml up -d

echo "[bootstrap] waiting for health"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:3010/api/health" >/dev/null; then
    echo "[bootstrap] healthy"
    exit 0
  fi
  sleep 2
done

echo "[bootstrap] healthcheck failed" >&2
docker compose -f compose.production.yaml ps >&2 || true
exit 1
