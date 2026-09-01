#!/usr/bin/env bash
# Encrypted logical backup for AbrChin. Never prints secrets. Never deletes
# the DB volume. Never restores into production.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=backup-common.sh
source "$ROOT/ops/backup-common.sh"

APP_DIR="${APP_DIR:-/opt/abrchin}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
DATA_ROOT="${DATA_ROOT:-${ABRCHIN_DATA_ROOT:-$APP_DIR}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/abrchin-postgres}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_MODE="${BACKUP_MODE:-docker}"
CONTAINER="${POSTGRES_CONTAINER:-abrchin-db}"
BACKUP_TARGET_SHA="${BACKUP_TARGET_SHA:-}"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-${ABRCHIN_BACKUP_KEY_FILE:-}}"

cd "$APP_DIR"

[[ -f "$ENV_FILE" ]] || backup_die "env file missing: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || backup_die "compose file missing: $COMPOSE_FILE"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

backup_require_cmd openssl
backup_require_cmd sha256sum
backup_require_cmd tar
backup_assert_key_file
backup_assert_destination "$BACKUP_DIR" "$DATA_ROOT" "$APP_DIR" \
  "${ABRCHIN_DATA_ROOT:-}" /var/lib/docker/volumes/abrchin_pg_data /var/lib/docker/volumes/abrchin_pg_data/_data

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sha_part="unknown"
if [[ -n "$BACKUP_TARGET_SHA" ]]; then
  sha_part="${BACKUP_TARGET_SHA:0:12}"
elif git rev-parse HEAD >/dev/null 2>&1; then
  sha_part="$(git rev-parse --short=12 HEAD)"
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/abrchin-backup.XXXXXX")"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT

stage="$work/abrchin-${stamp}-${sha_part}"
mkdir -p "$stage"
chmod 0700 "$stage"

pg_dump_cmd() {
  if [[ "$BACKUP_MODE" == "direct" ]]; then
    backup_require_cmd pg_dump
    pg_dump --no-owner --no-acl --format=plain
    return
  fi
  backup_require_cmd docker
  if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    CONTAINER="$(compose ps -q db 2>/dev/null || true)"
  fi
  [[ -n "$CONTAINER" ]] || backup_die "postgres container not found: $CONTAINER"
  local user db
  user="$(docker exec "$CONTAINER" printenv POSTGRES_USER 2>/dev/null || true)"
  db="$(docker exec "$CONTAINER" printenv POSTGRES_DB 2>/dev/null || true)"
  [[ -n "$user" && -n "$db" ]] || backup_die "POSTGRES_USER/POSTGRES_DB unresolved"
  docker exec "$CONTAINER" pg_dump -U "$user" -d "$db" --no-owner --no-acl --format=plain
}

psql_scalar() {
  local sql="$1"
  if [[ "$BACKUP_MODE" == "direct" ]]; then
    backup_require_cmd psql
    psql -Atqc "$sql" 2>/dev/null || echo 0
    return
  fi
  local user db
  user="$(docker exec "$CONTAINER" printenv POSTGRES_USER 2>/dev/null || true)"
  db="$(docker exec "$CONTAINER" printenv POSTGRES_DB 2>/dev/null || true)"
  docker exec "$CONTAINER" psql -U "$user" -d "$db" -Atqc "$sql" 2>/dev/null || echo 0
}

backup_log "writing logical dump (secrets not printed)"
pg_dump_cmd > "$stage/db.sql"
[[ -s "$stage/db.sql" ]] || backup_die "logical dump is empty"

schema_count="$(psql_scalar 'SELECT COUNT(*) FROM "_prisma_migrations"' || echo 0)"
instance_creds="$(psql_scalar 'SELECT COUNT(*) FROM "InstanceCredential"' || echo 0)"
inventory_creds="$(psql_scalar 'SELECT COUNT(*) FROM "PreprovisionedInventoryCredential"' || echo 0)"
nonce_rows="$(psql_scalar 'SELECT COUNT(*) FROM "MessageGoS2SReplayNonce"' || echo 0)"
db_version="$(psql_scalar 'SHOW server_version' || echo unknown)"

umask 077
cat > "$stage/metadata.json" <<EOF
{
  "product": "abrchin",
  "created_at": "${stamp}",
  "source_git_sha": "${sha_part}",
  "database_version": "${db_version}",
  "prisma_migrations": ${schema_count:-0},
  "instance_credential_rows": ${instance_creds:-0},
  "inventory_credential_rows": ${inventory_creds:-0},
  "replay_nonces": ${nonce_rows:-0},
  "includes_ciphertext": false,
  "includes_credential_plaintext": false
}
EOF

backup_write_inventory "$stage"
tar -C "$work" -cf "$work/archive.tar" "$(basename "$stage")"
backup_encrypt "$work/archive.tar" "$BACKUP_DIR/abrchin-${stamp}-${sha_part}.tar.enc"

verify_dir="$work/verify"
mkdir -p "$verify_dir"
backup_decrypt "$BACKUP_DIR/abrchin-${stamp}-${sha_part}.tar.enc" "$verify_dir/archive.tar"
tar -C "$verify_dir" -xf "$verify_dir/archive.tar"
backup_verify_inventory "$verify_dir/$(basename "$stage")" >/dev/null
backup_log "archive integrity verified"

backup_prune "$BACKUP_DIR" "$KEEP_DAYS" 'abrchin-*.tar.enc'
backup_prune "$BACKUP_DIR" "$KEEP_DAYS" 'abrchin-*.sql.gz'
chmod 0600 "$BACKUP_DIR/abrchin-${stamp}-${sha_part}.tar.enc"
backup_log "done: abrchin-${stamp}-${sha_part}.tar.enc"
echo "$BACKUP_DIR/abrchin-${stamp}-${sha_part}.tar.enc"
