#!/usr/bin/env bash
# Shared backup helpers. Never print secret values.
set -Eeuo pipefail

backup_die() {
  echo "[backup] ERROR: $*" >&2
  exit 1
}

backup_log() {
  echo "[backup] $*"
}

backup_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || backup_die "required command not found: $1"
}

backup_use_local_postgres_binaries() {
  local dir
  for dir in /usr/lib/postgresql/*/bin; do
    if [[ -d "$dir" ]]; then
      PATH="$dir:$PATH"
    fi
  done
  export PATH
}

backup_use_local_postgres_binaries

backup_realpath() {
  local path="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath -m "$path"
  else
    readlink -f "$path" 2>/dev/null || echo "$path"
  fi
}

backup_assert_destination() {
  local dest data
  dest="$(backup_realpath "${1:?BACKUP_DIR is required}")"
  shift
  for data in "$@"; do
    [[ -n "$data" ]] || continue
    data="$(backup_realpath "$data")"
    if [[ "$dest" == "$data" ]]; then
      backup_die "backup destination '$dest' must not be the data location '$data'"
    fi
    case "$dest" in
      "$data"/*)
        backup_die "backup destination '$dest' must not be inside data location '$data'"
        ;;
    esac
  done
  mkdir -p "$dest"
  chmod 0700 "$dest" || true
}

backup_assert_key_file() {
  local key="${BACKUP_KEY_FILE:?BACKUP_KEY_FILE is required}"
  [[ -f "$key" ]] || backup_die "BACKUP_KEY_FILE missing: $key"
  [[ -L "$key" ]] && backup_die "BACKUP_KEY_FILE must not be a symlink"
  local mode
  mode="$(stat -c '%a' "$key" 2>/dev/null || stat -f '%OLp' "$key")"
  if [[ "$mode" != "600" && "$mode" != "0600" ]]; then
    backup_die "BACKUP_KEY_FILE permissions must be 0600 (got $mode)"
  fi
  local size
  size="$(wc -c < "$key" | tr -d ' ')"
  if [[ "${size:-0}" -lt 32 ]]; then
    backup_die "BACKUP_KEY_FILE must contain at least 32 bytes"
  fi
}

backup_encrypt() {
  local src="$1"
  local dest="$2"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "$src" -out "$dest" -pass "file:${BACKUP_KEY_FILE}"
  chmod 0600 "$dest"
}

backup_decrypt() {
  local src="$1"
  local dest="$2"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "$src" -out "$dest" -pass "file:${BACKUP_KEY_FILE}"
}

backup_write_inventory() {
  local dir="$1"
  (
    cd "$dir"
    find . -type f ! -name inventory.sha256 | sort | while read -r file; do
      sha256sum "$file"
    done
  ) > "$dir/inventory.sha256"
}

backup_verify_inventory() {
  local dir="$1"
  (
    cd "$dir"
    sha256sum -c inventory.sha256
  )
}

backup_prune() {
  local dest="$1"
  local days="$2"
  local pattern="$3"
  find "$dest" -type f -name "$pattern" -mtime +"$days" -delete || true
}
