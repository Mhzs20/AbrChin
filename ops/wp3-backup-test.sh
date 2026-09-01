#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=backup-common.sh
source "$ROOT/ops/backup-common.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/abrchin-wp3-backup.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
fail() { echo "[wp3-backup-test] ERROR: $*" >&2; exit 1; }
log() { echo "[wp3-backup-test] $*"; }

key="$work/backup.key"
dd if=/dev/urandom bs=32 count=1 of="$key" status=none
chmod 0600 "$key"
data="$work/data"
mkdir -p "$data"
log "preflight must fail when dest equals data"
if BACKUP_KEY_FILE="$key" DATA_ROOT="$data" BACKUP_DIR="$data" BACKUP_MODE=direct \
  APP_DIR="$ROOT" ENV_FILE=".env.production.example" COMPOSE_FILE="compose.production.yaml" \
  bash "$ROOT/ops/backup-postgres.sh" >/dev/null 2>"$work/preflight.err"; then
  fail "backup unexpectedly succeeded with dest==data"
fi
grep -q "must not be the data location" "$work/preflight.err" || fail "missing destination gate"

if ! command -v initdb >/dev/null || ! command -v pg_ctl >/dev/null || ! command -v pg_dump >/dev/null; then
  log "SKIP isolated restore: initdb/pg_ctl/pg_dump not installed"
  exit 0
fi

port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
pgdata="$work/src-pg"
initdb -D "$pgdata" --auth=trust --username=postgres >/dev/null
pg_ctl -D "$pgdata" -o "-p ${port} -k ${pgdata} -h 127.0.0.1" -w start >/dev/null
psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -c "CREATE DATABASE abrchin" >/dev/null
psql -h 127.0.0.1 -p "$port" -U postgres -d abrchin -c 'CREATE TABLE "Widget"(id int); INSERT INTO "Widget" VALUES (1);' >/dev/null

dest="$work/backups"
mkdir -p "$dest"
set +e
PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres PGDATABASE=abrchin \
BACKUP_KEY_FILE="$key" DATA_ROOT="$data" BACKUP_DIR="$dest" BACKUP_MODE=direct \
APP_DIR="$ROOT" ENV_FILE=".env.production.example" COMPOSE_FILE="compose.production.yaml" \
BACKUP_TARGET_SHA=testdeadbeef \
  bash "$ROOT/ops/backup-postgres.sh" >"$work/backup.out" 2>"$work/backup.err"
st=$?
pg_ctl -D "$pgdata" -m fast stop >/dev/null
set -e
[[ "$st" -eq 0 ]] || fail "backup failed: $(cat "$work/backup.err")"
archive="$(ls -1 "$dest"/abrchin-*.tar.enc | head -n 1)"
[[ -n "$archive" ]] || fail "encrypted archive missing"
RESTORE_RECEIPT="$work/receipt.json" BACKUP_KEY_FILE="$key" DATA_ROOT="$data" \
  bash "$ROOT/ops/restore-verify.sh" "$archive" >/dev/null
python3 - "$work/receipt.json" <<'PY'
import json,sys
receipt=json.load(open(sys.argv[1]))
assert receipt["verification"]=="pass"
assert receipt["production_restore"] is False
assert receipt["source_git_sha"]=="testdeadbeef"
print("restore receipt ok")
PY
log "PASS"
