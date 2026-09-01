#!/usr/bin/env bash
# Decrypt an AbrChin backup and restore it into an isolated temporary
# PostgreSQL cluster. Never restores into production.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=backup-common.sh
source "$ROOT/ops/backup-common.sh"

ARCHIVE="${1:-${BACKUP_ARCHIVE:-}}"
[[ -n "$ARCHIVE" ]] || backup_die "usage: restore-verify.sh /path/to/abrchin-*.tar.enc"
[[ -f "$ARCHIVE" ]] || backup_die "archive missing: $ARCHIVE"

BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-${ABRCHIN_BACKUP_KEY_FILE:-}}"
DATA_ROOT="${DATA_ROOT:-${ABRCHIN_DATA_ROOT:-}}"
backup_assert_key_file
backup_require_cmd openssl
backup_require_cmd tar
backup_require_cmd initdb
backup_require_cmd postgres
backup_require_cmd pg_ctl
backup_require_cmd psql

work="$(mktemp -d "${TMPDIR:-/tmp}/abrchin-restore.XXXXXX")"
pgdata="$work/pgdata"
extract="$work/extract"
receipt="$work/restore-receipt.json"
cleanup() {
  if [[ -d "$pgdata" ]] && pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
    pg_ctl -D "$pgdata" -m fast stop >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

if [[ -n "$DATA_ROOT" ]]; then
  case "$(backup_realpath "$work")" in
    "$(backup_realpath "$DATA_ROOT")"/*)
      backup_die "refusing to create restore target inside DATA_ROOT"
      ;;
  esac
fi

mkdir -p "$extract"
backup_decrypt "$ARCHIVE" "$work/archive.tar"
tar -C "$extract" -xf "$work/archive.tar"
stage="$(find "$extract" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "$stage" && -f "$stage/db.sql" ]] || backup_die "archive did not contain db.sql"
backup_verify_inventory "$stage" >/dev/null

initdb -D "$pgdata" --auth=trust --username=postgres >/dev/null
chmod 0700 "$pgdata"
port="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"
pg_ctl -D "$pgdata" -o "-p ${port} -k ${pgdata} -h 127.0.0.1" -w start >/dev/null
psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE restoredb" >/dev/null
psql -h 127.0.0.1 -p "$port" -U postgres -d restoredb -v ON_ERROR_STOP=1 -f "$stage/db.sql" >/dev/null
tables="$(psql -h 127.0.0.1 -p "$port" -U postgres -d restoredb -Atqc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")"
db_version="$(psql -h 127.0.0.1 -p "$port" -U postgres -d restoredb -Atqc 'SHOW server_version')"
source_sha="$(python3 - "$stage/metadata.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1])).get("source_git_sha","unknown"))
PY
)"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pg_ctl -D "$pgdata" -m fast stop >/dev/null
verification="pass"
if [[ "${tables:-0}" -lt 1 ]]; then
  verification="fail"
fi

umask 077
cat > "$receipt" <<EOF
{
  "product": "abrchin",
  "verified_at": "${started}",
  "archive": "$(basename "$ARCHIVE")",
  "source_git_sha": "${source_sha}",
  "database_version": "${db_version}",
  "public_tables": ${tables:-0},
  "restore_target": "temporary-isolated",
  "production_restore": false,
  "verification": "${verification}"
}
EOF

receipt_out="${RESTORE_RECEIPT:-$PWD/abrchin-restore-receipt.json}"
cp "$receipt" "$receipt_out"
chmod 0600 "$receipt_out"
backup_log "restore verification ${verification}; receipt ${receipt_out}"
[[ "$verification" == "pass" ]] || exit 1
