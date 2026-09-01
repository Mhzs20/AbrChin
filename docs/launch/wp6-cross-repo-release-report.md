# WP6 cross-repo release report

Product = MessageGo 1.0.0. Public API = `/v1`. AbrChin Wallet remains the
only wallet authority.

```text
verdict = READY_FOR_OWNER_TEST
owner_accepted = false
PRODUCTION NOT AUTHORIZED
LIVE PROVIDER TRAFFIC NOT AUTHORIZED
READY_FOR_FIRST_PRODUCTION_DEPLOYMENT = NO
```

This report does not execute deploy, production migrations, live provider
traffic, or owner acceptance.

## Tested SHAs

| Repo | Starting `origin/main` before WP6 gate fixes | Tested SHA for this receipt |
| --- | --- | --- |
| AbrChin | `96663b17514b020ef1d25cf04da7f2dd601534ce` | `0c08c89bb60ae6066133eb73d4303a4abefb2aac` |
| MessageGo | `4d473393657403fd0cdd17dbba66a31d62c4c2fb` | `c869a677607567b952d8598f97cf8adeeb3932b3` |

Canonical receipts:

- `docs/launch/wp6-release-truth.md`
- `docs/launch/evidence/wp6/receipt.json`
- `docs/launch/evidence/wp6/receipt.md`
- MessageGo `docs/program/wp6-release-truth-pointer.md`
- Unsigned checklist: `docs/launch/wp6-owner-acceptance-checklist.md`

Command: `npm run test:wp6`

Started: `2026-09-01T22:55:32.337Z`
Ended: `2026-09-01T23:00:37.405Z`

Totals: pass=1782 fail=0 skip=0. Required skip = NO-GO; none skipped.

## Environment (local production-candidate)

- PostgreSQL 16.15 at `127.0.0.1:5432` (real)
- Redis 7.0.15 at `127.0.0.1:6379` (real)
- NATS 2.10.7 JetStream at `127.0.0.1:4222` (real)
- Node v22.22.2
- Go toolchain `go1.25.13` (module `go 1.25.0`, `toolchain go1.25.13`)
- Docker daemon down; `docker compose config` validated without starting containers
- Payment/SMS/SMTP adapters: MOCK / console / console
- `ARVAN_ENABLED=false`, `ARVAN_MUTATIONS_ENABLED=false`, `CRX_PROVIDER_TRAFFIC_ENABLED=false`
- MessageGo settlement / customer AI / secret-handoff gates remain false

AbrChin Prisma migrations in tree: 59. Isolated restore verified; production restore was not performed.

## Audits

| Gate | Result |
| --- | --- |
| `npm audit --omit=dev --audit-level=low` | pass (0 production-omit-dev vulnerabilities after `deepmerge-ts` override) |
| `govulncheck ./...` with `GOTOOLCHAIN=go1.25.13` | pass (0 called vulnerabilities) |
| Secret scan | pass |
| Compose config (AbrChin + MessageGo) | pass without daemon |

Residual: uncalled module-graph vulnerabilities may remain; Docker daemon was down.

## Owner acceptance

Checklist is unsigned. No box is checked. Owner: Mohammad.

Owner steps (not executed by this agent):

1. Complete `docs/launch/wp6-owner-acceptance-checklist.md` with an explicit signature and date.
2. Exercise the Golden Path on a Founder-authorized staging host (PREPAID 1/3/6/12).
3. Supply legal identity fields in `docs/launch/legal-entity-blocker.md`.
4. Do not treat this receipt as production authorization.

## Production deploy commands — not executed

AbrChin (`docs/production-deployment.md`):

```bash
cd /opt/abrchin
git fetch --prune origin
git checkout main
git pull --ff-only origin main
TARGET_SHA="$(git rev-parse HEAD)"
export APP_DIR="/opt/abrchin"
export ENV_FILE=".env"
export COMPOSE_FILE="compose.production.yaml"
export ABRCHIN_IMAGE="abrchin:${TARGET_SHA:0:12}"
export DEPLOY_IMAGE_SOURCE="local"
export BACKUP_BEFORE_DEPLOY="1"
./ops/deploy.sh
```

MessageGo single-server compose (`deployments/single-server/docker-compose.yml`)
was config-validated only. `CRX_AUTO_MIGRATE`, `CRX_AI_ENABLED`,
`CRX_PROVIDER_TRAFFIC_ENABLED`, and `CRX_S2S_REPLAY_STORE_ENABLED` remain
fail-closed defaults of `"false"`. No production `up` was run.

## Rollback — not executed

AbrChin code rollback preserves the database and volumes. Forbidden:
`docker compose down -v` and `prisma migrate reset`.

```bash
cd /opt/abrchin
PREVIOUS_IMAGE="abrchin:<previous-sha>"
sed -i "s|^ABRCHIN_IMAGE=.*$|ABRCHIN_IMAGE=${PREVIOUS_IMAGE}|" .env
export ABRCHIN_IMAGE="$PREVIOUS_IMAGE"
docker compose --env-file .env -f compose.production.yaml \
  up -d --no-deps --force-recreate --wait --wait-timeout 120 \
  web worker catalog-sync
```

MessageGo rollback must not DROP expand-only tables, rewrite V1 locked
scope, or redispatch AI after an uncertain reserve.

## GO / NO-GO

| Decision | Status |
| --- | --- |
| Automated WP6 required gates | GO — `READY_FOR_OWNER_TEST` |
| Owner acceptance | NO-GO — unsigned |
| Production deploy | NO-GO — not authorized |
| Live provider traffic | NO-GO — not authorized |
| First production deployment | NO |

Final status: `READY_FOR_OWNER_TEST — PRODUCTION NOT AUTHORIZED`
