#!/bin/sh
set -eu
. ./scripts/export-file-secrets.sh
abrchin_export_runtime_secrets
exec node ./node_modules/prisma/build/index.js migrate deploy
