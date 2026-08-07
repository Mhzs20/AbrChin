#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

required=(
  ABRCHIN_IMAGE
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  SESSION_SECRET
  CREDENTIAL_ENCRYPTION_KEY
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

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "[bootstrap] validating compose"
compose config --quiet

echo "[bootstrap] starting db"
compose up -d db --wait --wait-timeout 120

echo "[bootstrap] migration gate (bootstrap recovery may also set ABRCHIN_RUN_MIGRATE_ON_START=true)"
compose run --rm --no-deps \
  -e ABRCHIN_RUN_MIGRATE_ON_START=false \
  web \
  node ./node_modules/prisma/build/index.js migrate deploy

echo "[bootstrap] starting app services"
compose up -d --remove-orphans --wait --wait-timeout 180 web worker catalog-sync

echo "[bootstrap] waiting for health"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:3010/api/health" >/dev/null; then
    echo "[bootstrap] healthy"
    exit 0
  fi
  sleep 2
done

echo "[bootstrap] healthcheck failed" >&2
compose ps >&2 || true
exit 1
