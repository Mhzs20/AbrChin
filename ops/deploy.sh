#!/usr/bin/env bash
set -Eeuo pipefail

: "${ABRCHIN_IMAGE:?ABRCHIN_IMAGE must contain an immutable image tag}"

APP_DIR="${APP_DIR:-/opt/abrchin}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yaml}"
CONTAINER_NAME="abrchin-web"

cd "$APP_DIR"

previous_image="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"

rollback() {
  if [[ -z "$previous_image" ]]; then
    echo "Deployment failed and there is no previous image to restore." >&2
    return 1
  fi

  echo "Restoring $previous_image ..." >&2
  ABRCHIN_IMAGE="$previous_image" docker compose -f "$COMPOSE_FILE" up \
    -d --remove-orphans --wait --wait-timeout 90
}

docker compose -f "$COMPOSE_FILE" pull web

if ! docker compose -f "$COMPOSE_FILE" up -d --remove-orphans --wait --wait-timeout 90; then
  rollback || true
  exit 1
fi

if ! curl --fail --silent --show-error --retry 5 --retry-all-errors \
  http://127.0.0.1:3010/api/health >/dev/null; then
  rollback || true
  exit 1
fi

docker image prune --force >/dev/null
echo "AbrChin is healthy on $ABRCHIN_IMAGE"
