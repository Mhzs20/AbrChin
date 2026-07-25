#!/bin/sh
set -eu

echo "[abrchin] running prisma migrate deploy"
node ./node_modules/prisma/build/index.js migrate deploy

echo "[abrchin] starting web"
exec node server.js
