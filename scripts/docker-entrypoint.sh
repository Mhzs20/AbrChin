#!/bin/sh
set -eu

. ./scripts/export-file-secrets.sh
abrchin_export_runtime_secrets

# Production deploy uses an explicit migration gate in ops/deploy.sh.
# Default: skip migrate on normal web start to avoid racing schema mutations.
# Set ABRCHIN_RUN_MIGRATE_ON_START=true for bootstrap/recovery only.
run_migrate="${ABRCHIN_RUN_MIGRATE_ON_START:-false}"

case "$run_migrate" in
  1|true|TRUE|yes|YES|on|ON)
    echo "[abrchin] running prisma migrate deploy (ABRCHIN_RUN_MIGRATE_ON_START=${run_migrate})"
    node ./node_modules/prisma/build/index.js migrate deploy
    ;;
  *)
    echo "[abrchin] skipping migrate on start (ABRCHIN_RUN_MIGRATE_ON_START=${run_migrate:-false})"
    ;;
esac

echo "[abrchin] starting web"
exec node server.js
