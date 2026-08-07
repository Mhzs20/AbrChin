#!/usr/bin/env bash
# AbrChin production deploy — local immutable image by default.
# Never deletes DB volumes. Never runs prisma migrate reset.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/abrchin}"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
DEPLOY_IMAGE_SOURCE="${DEPLOY_IMAGE_SOURCE:-local}"
BACKUP_BEFORE_DEPLOY="${BACKUP_BEFORE_DEPLOY:-1}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/var/lock/abrchin-deploy.lock}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://abrchin.ir/api/health}"
PUBLIC_READINESS_URL="${PUBLIC_READINESS_URL:-https://abrchin.ir/api/readiness}"
PUBLIC_STOREFRONT_URL="${PUBLIC_STOREFRONT_URL:-https://abrchin.ir/cloud-servers}"
MIGRATED=0
PREVIOUS_IMAGE=""
PREVIOUS_GIT_SHA=""
TARGET_SHA=""
TMP_ENV=""
LOCK_FD=""

cleanup() {
  local exit_code=$?
  if [[ -n "${TMP_ENV:-}" && -f "${TMP_ENV}" ]]; then
    rm -f "${TMP_ENV}"
  fi
  if [[ -n "${LOCK_FD:-}" ]]; then
    flock -u "${LOCK_FD}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

die() {
  echo "[deploy] ERROR: $*" >&2
  exit 1
}

log() {
  echo "[deploy] $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

require_cmd docker
require_cmd curl
require_cmd flock
require_cmd git

[[ -d "$APP_DIR" ]] || die "APP_DIR does not exist: $APP_DIR"
cd "$APP_DIR"

[[ -f "$ENV_FILE" ]] || die "env file missing: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || die "compose file missing: $COMPOSE_FILE"
[[ -x ./ops/backup-postgres.sh || -f ./ops/backup-postgres.sh ]] || die "ops/backup-postgres.sh missing"

# ENV_FILE is a Docker Compose dotenv, not a Bash script.
# Never `source` / `.` it: values such as `PARSPACK_API_TOKEN=Bearer …` are
# legal for Compose but are NOT valid shell assignments and will break deploy
# before build/migration. App and DB secrets load only through:
#   docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ...
# Script control knobs come from explicit exports or the defaults above
# (APP_DIR, ENV_FILE, COMPOSE_FILE, ABRCHIN_IMAGE, DEPLOY_IMAGE_SOURCE,
# BACKUP_BEFORE_DEPLOY, …).

: "${ABRCHIN_IMAGE:?ABRCHIN_IMAGE must be set to an immutable image tag (never :latest)}"
case "$ABRCHIN_IMAGE" in
  *:latest|*:LATEST)
    die "ABRCHIN_IMAGE must be immutable; refusing tag '$ABRCHIN_IMAGE'"
    ;;
  *:*)
    ;;
  *)
    die "ABRCHIN_IMAGE must include an immutable tag (e.g. abrchin:<sha>)"
    ;;
esac

case "$DEPLOY_IMAGE_SOURCE" in
  local|registry) ;;
  *) die "DEPLOY_IMAGE_SOURCE must be local or registry (got: $DEPLOY_IMAGE_SOURCE)" ;;
esac

case "$BACKUP_BEFORE_DEPLOY" in
  0|1) ;;
  *) die "BACKUP_BEFORE_DEPLOY must be 0 or 1" ;;
esac

# Host-level exclusive deploy lock.
mkdir -p "$(dirname "$DEPLOY_LOCK_FILE")"
exec {LOCK_FD}>"$DEPLOY_LOCK_FILE"
if ! flock -n "$LOCK_FD"; then
  die "another production deploy is already active (lock: $DEPLOY_LOCK_FILE)"
fi

TARGET_SHA="$(git rev-parse HEAD)"
PREVIOUS_GIT_SHA="$(git rev-parse HEAD@{1} 2>/dev/null || true)"
PREVIOUS_IMAGE="$(docker inspect --format='{{.Config.Image}}' abrchin-web 2>/dev/null || true)"

log "target_sha=${TARGET_SHA}"
log "abrchin_image=${ABRCHIN_IMAGE}"
log "deploy_image_source=${DEPLOY_IMAGE_SOURCE}"
log "backup_before_deploy=${BACKUP_BEFORE_DEPLOY}"
if [[ -n "$PREVIOUS_IMAGE" ]]; then
  log "previous_running_web_image=${PREVIOUS_IMAGE}"
else
  log "previous_running_web_image=(none)"
fi

# Dirty tree is allowed only for tracked ops scripts the Founder may chmod;
# refuse unexpected content drift on production checkout.
if [[ -n "$(git status --porcelain)" ]]; then
  log "WARNING: working tree is not clean:"
  git status --short >&2
  die "refusing deploy with dirty git working tree; commit/stash or reset first"
fi

# Validate compose without printing secret values.
log "validating compose config"
compose config --quiet

# --- 2. Build or pull candidate image BEFORE touching healthy app services ---
if [[ "$DEPLOY_IMAGE_SOURCE" == "local" ]]; then
  log "building local immutable image ${ABRCHIN_IMAGE}"
  docker build --pull -t "$ABRCHIN_IMAGE" .
else
  log "pulling immutable registry image ${ABRCHIN_IMAGE}"
  docker pull "$ABRCHIN_IMAGE"
fi

docker image inspect "$ABRCHIN_IMAGE" >/dev/null \
  || die "candidate image inspect failed: $ABRCHIN_IMAGE"

# Persist ABRCHIN_IMAGE into env file for subsequent compose ops / rollback docs.
# Never print file contents (may contain secrets).
if grep -q '^ABRCHIN_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^ABRCHIN_IMAGE=.*$|ABRCHIN_IMAGE=${ABRCHIN_IMAGE}|" "$ENV_FILE"
else
  printf '\nABRCHIN_IMAGE=%s\n' "$ABRCHIN_IMAGE" >> "$ENV_FILE"
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true
# Keep process env aligned after rewrite.
export ABRCHIN_IMAGE

restore_previous_image() {
  if [[ -z "$PREVIOUS_IMAGE" ]]; then
    log "no previous image available to restore"
    return 1
  fi
  if [[ "$PREVIOUS_IMAGE" == "$ABRCHIN_IMAGE" ]]; then
    log "previous image equals candidate; nothing to restore"
    return 1
  fi
  log "restoring previous image: $PREVIOUS_IMAGE"
  if grep -q '^ABRCHIN_IMAGE=' "$ENV_FILE"; then
    sed -i "s|^ABRCHIN_IMAGE=.*$|ABRCHIN_IMAGE=${PREVIOUS_IMAGE}|" "$ENV_FILE"
  fi
  ABRCHIN_IMAGE="$PREVIOUS_IMAGE" compose up -d --remove-orphans --wait --wait-timeout 120 \
    web worker catalog-sync
}

handle_failure() {
  local stage="$1"
  echo "[deploy] FAILED at stage: ${stage}" >&2
  if [[ "$MIGRATED" -eq 0 ]]; then
    log "failure before migration — attempting restore of previous image"
    restore_previous_image || true
  else
    cat >&2 <<'EOF'
[deploy] failure AFTER migration gate.
Additive forward-only migrations were applied. Database/volume were NOT deleted.
Automatic destructive rollback is forbidden.
If independent audit confirmed previous image is schema-compatible (additive-only),
you may restore the previous immutable image manually WITHOUT volume reset.
Otherwise keep DB intact and perform forward-fix / manual recovery.
EOF
    if [[ -n "$PREVIOUS_IMAGE" ]]; then
      log "previous_image_for_manual_consideration=${PREVIOUS_IMAGE}"
      log "NOTE: auto-restore after migration is skipped by policy unless you run rollback commands intentionally."
    fi
  fi
  exit 1
}

# --- 3. Start/verify DB only ---
log "ensuring database is healthy"
compose up -d db --wait --wait-timeout 120 || handle_failure "db_up"
compose ps db

# --- 4. Backup ---
if [[ "$BACKUP_BEFORE_DEPLOY" == "1" ]]; then
  log "taking PostgreSQL backup before migration"
  BACKUP_TARGET_SHA="$TARGET_SHA" \
  APP_DIR="$APP_DIR" \
  ENV_FILE="$ENV_FILE" \
  COMPOSE_FILE="$COMPOSE_FILE" \
    bash ./ops/backup-postgres.sh || handle_failure "backup"
fi

# --- 5. Explicit migration gate (one-shot; does not start Next.js) ---
# Dockerfile uses CMD (not ENTRYPOINT), so command override replaces the web
# entrypoint entirely and will not start server.js.
log "running prisma migrate deploy against candidate image"
# Mark migrated BEFORE migrate runs: a partial apply must NEVER auto-restore
# the previous image onto a DB that already received additive migrations.
MIGRATED=1
if ! compose run --rm --no-deps \
  -e ABRCHIN_RUN_MIGRATE_ON_START=false \
  web \
  node ./node_modules/prisma/build/index.js migrate deploy; then
  handle_failure "migration"
fi
log "migration gate passed"

# --- 6. Start app services on the same immutable image ---
log "starting web worker catalog-sync"
compose up -d --remove-orphans --wait --wait-timeout 180 \
  web worker catalog-sync || handle_failure "app_up"

# --- 7. Local health/readiness ---
# /api/readiness returns HTTP 503 for both degraded and outage. Launch may be
# degraded when provider billing contracts are unverified; that must not block
# deploy. Outage (DB/worker critical) must fail the gate.
local_readiness_acceptable() {
  local code status
  curl -fsS --max-time 5 "http://127.0.0.1:3010/api/health" >/dev/null || return 1
  code="$(curl -sS --max-time 5 -o /tmp/abrchin-deploy-readiness.json -w '%{http_code}' \
    "http://127.0.0.1:3010/api/readiness" || echo 000)"
  status="$(sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    /tmp/abrchin-deploy-readiness.json 2>/dev/null | head -n 1)"
  if [[ "$code" == "200" && "$status" == "operational" ]]; then
    return 0
  fi
  if [[ "$status" == "degraded" ]]; then
    log "readiness is degraded (acceptable for launch when non-critical components are stale)"
    return 0
  fi
  return 1
}

log "checking local health endpoints"
local_ok=0
for attempt in $(seq 1 40); do
  if local_readiness_acceptable; then
    local_ok=1
    break
  fi
  sleep 3
done
[[ "$local_ok" -eq 1 ]] || handle_failure "local_health"

# --- 8. Public checks (status only; do not dump bodies) ---
log "checking public endpoints"
public_ok=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 10 -o /dev/null -w '' "$PUBLIC_HEALTH_URL" \
    && curl -fsS --max-time 10 -o /dev/null -w '' "$PUBLIC_READINESS_URL" \
    && curl -fsS --max-time 15 -o /dev/null -w '' "$PUBLIC_STOREFRONT_URL"; then
    public_ok=1
    break
  fi
  sleep 3
done
if [[ "$public_ok" -ne 1 ]]; then
  log "WARNING: public endpoint checks failed (local checks passed). Continuing service verification."
  log "Founder should verify public DNS/proxy if this persists."
fi

# --- 9. Service verification ---
log "compose service status"
compose ps db web worker catalog-sync

web_image="$(docker inspect --format='{{.Config.Image}}' abrchin-web)"
worker_image="$(docker inspect --format='{{.Config.Image}}' abrchin-worker)"
sync_image="$(docker inspect --format='{{.Config.Image}}' abrchin-catalog-sync)"
[[ "$web_image" == "$ABRCHIN_IMAGE" ]] || handle_failure "web_image_mismatch"
[[ "$worker_image" == "$ABRCHIN_IMAGE" ]] || handle_failure "worker_image_mismatch"
[[ "$sync_image" == "$ABRCHIN_IMAGE" ]] || handle_failure "catalog_sync_image_mismatch"

# --- 10. Success: keep previous image; optional dangling cleanup only ---
if [[ -n "$PREVIOUS_IMAGE" && "$PREVIOUS_IMAGE" != "$ABRCHIN_IMAGE" ]]; then
  log "keeping previous image available for rollback window: $PREVIOUS_IMAGE"
fi
# Do NOT prune the previous known-good tagged image. Only dangling layers.
docker image prune --force >/dev/null 2>&1 || true

cat <<EOF
[deploy] SUCCESS
target_sha=${TARGET_SHA}
abrchin_image=${ABRCHIN_IMAGE}
previous_image=${PREVIOUS_IMAGE:-none}
migration=applied
local_health=ok
public_health=${public_ok}
worker=running
catalog-sync=running
EOF
