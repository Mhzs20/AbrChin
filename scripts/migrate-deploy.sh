#!/bin/sh
set -eu
. ./scripts/export-file-secrets.sh
abrchin_export_runtime_secrets
node --experimental-strip-types ./scripts/parspack-drop-gate.mts
exec node ./node_modules/prisma/build/index.js migrate deploy
