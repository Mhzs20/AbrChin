#!/usr/bin/env bash
set -euo pipefail

# Compact daily Postgres dump for abrchin.
# Intended for cron. Optional remote sync (rclone/Google Drive) can hook after dump.

BACKUP_DIR="${BACKUP_DIR:-/var/backups/abrchin-postgres}"
KEEP_DAYS="${KEEP_DAYS:-7}"
CONTAINER="${POSTGRES_CONTAINER:-abrchin-db}"
POSTGRES_DB="${POSTGRES_DB:-abrchin}"
POSTGRES_USER="${POSTGRES_USER:-abrchin}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
outfile="$BACKUP_DIR/abrchin-$stamp.sql.gz"

echo "[backup] writing compressed dump"
docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl \
  | gzip -c > "$outfile"

echo "[backup] pruning dumps older than ${KEEP_DAYS} days"
find "$BACKUP_DIR" -type f -name 'abrchin-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "[backup] done: $(basename "$outfile")"
echo "[backup] optional next step: rclone copy \"$BACKUP_DIR\" remote:abrchin-db-backups"
