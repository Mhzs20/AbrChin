#!/bin/sh
set -eu
. ./scripts/export-file-secrets.sh
abrchin_export_runtime_secrets
exec node dist/catalog-sync/catalog-sync-scheduler.js
