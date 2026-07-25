#!/bin/sh
set -eu

echo "[abrchin] running prisma migrate deploy"
npx prisma migrate deploy

echo "[abrchin] starting web"
exec node server.js
