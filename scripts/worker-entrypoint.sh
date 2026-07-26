#!/bin/sh
set -eu

echo "[abrchin-worker] running prisma migrate deploy"
node ./node_modules/prisma/build/index.js migrate deploy

echo "[abrchin-worker] starting provisioning worker"
exec node --experimental-strip-types ./scripts/provisioning-worker.mts
