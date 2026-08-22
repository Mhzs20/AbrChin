#!/usr/bin/env bash
# Compact PostgreSQL dump for AbrChin production.
# Uses production compose/env contract. Never echoes passwords.
# Never deletes the DB volume.
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/abrchin}"
# Production host keeps its secrets in /opt/abrchin/.env (fingerprinted by
# ABRCHIN_IMAGE after every deploy). .env.production was a stale stub that
# repeatedly blocked deploys, so .env is the canonical default.
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/abrchin-postgres}"
KEEP_DAYS="${KEEP_DAYS:-14}"
CONTAINER="${POSTGRES_CONTAINER:-abrchin-db}"
BACKUP_TARGET_SHA="${BACKUP_TARGET_SHA:-}"

cd "$APP_DIR"

[[ -f "$ENV_FILE" ]] || { echo "[backup] ERROR: env file missing: $ENV_FILE" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "[backup] ERROR: compose file missing: $COMPOSE_FILE" >&2; exit 1; }

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[backup] ERROR: postgres container not found: $CONTAINER" >&2
  exit 1
fi

# Resolve DB/user from the running container env (never print values).
POSTGRES_DB="$(docker exec "$CONTAINER" printenv POSTGRES_DB 2>/dev/null || true)"
POSTGRES_USER="$(docker exec "$CONTAINER" printenv POSTGRES_USER 2>/dev/null || true)"
[[ -n "$POSTGRES_DB" ]] || { echo "[backup] ERROR: POSTGRES_DB unresolved from container" >&2; exit 1; }
[[ -n "$POSTGRES_USER" ]] || { echo "[backup] ERROR: POSTGRES_USER unresolved from container" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sha_part="unknown"
if [[ -n "$BACKUP_TARGET_SHA" ]]; then
  sha_part="${BACKUP_TARGET_SHA:0:12}"
elif git rev-parse HEAD >/dev/null 2>&1; then
  sha_part="$(git rev-parse --short=12 HEAD)"
fi
outfile="$BACKUP_DIR/abrchin-${stamp}-${sha_part}.sql.gz"
tmpfile="${outfile}.partial"

cleanup() {
  rm -f "$tmpfile"
}
trap cleanup EXIT

echo "[backup] writing compressed dump (db/user resolved from container; secrets not printed)"
# pg_dump inside container; host only receives stdout bytes for gzip.
if ! docker exec "$CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl \
  | gzip -c > "$tmpfile"; then
  echo "[backup] ERROR: pg_dump failed" >&2
  exit 1
fi

[[ -f "$tmpfile" ]] || { echo "[backup] ERROR: dump file missing" >&2; exit 1; }
size="$(wc -c < "$tmpfile" | tr -d ' ')"
if [[ "${size:-0}" -le 0 ]]; then
  echo "[backup] ERROR: dump file is empty" >&2
  exit 1
fi

mv "$tmpfile" "$outfile"
trap - EXIT

echo "[backup] pruning dumps older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -type f -name 'abrchin-*.sql.gz' -mtime +"$KEEP_DAYS" -delete || true

echo "[backup] done: $(basename "$outfile") (${size} bytes)"
echo "[backup] optional next step: rclone copy \"$BACKUP_DIR\" remote:abrchin-db-backups"
