#!/bin/sh
set -eu

# Migrations are an explicit one-shot gate in ops/deploy.sh.
# Workers must never run prisma migrate on start/restart.
echo "[abrchin-worker] starting provisioning worker"
exec node dist/worker/provisioning-worker.js
