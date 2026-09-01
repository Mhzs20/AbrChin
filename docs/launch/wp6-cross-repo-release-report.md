# WP6 cross-repo release report

Product = MessageGo 1.0.0. Public API = `/v1`. AbrChin Wallet remains the
only wallet authority. Internal package names must not create public V2
branding.

```text
verdict = READY_FOR_OWNER_TEST
owner_accepted = false
PRODUCTION NOT AUTHORIZED
LIVE PROVIDER TRAFFIC NOT AUTHORIZED
READY_FOR_FIRST_PRODUCTION_DEPLOYMENT = NO
```

This report does not execute deploy, production migrations, live provider
traffic, or owner acceptance. Missing evidence is not converted into a pass.

## SHAs

| Repo | Starting `origin/main` before this re-run | Tested SHA for this receipt |
| --- | --- | --- |
| AbrChin | `bf9ce360de86b65ef4481f1da438614a67edbaff` | `991f62530301d099a7c7d16a7ca4e51d22307dfb` |
| MessageGo | `c822352d555d9f5c8bef4e52e676c17ea64c258b` | `c822352d555d9f5c8bef4e52e676c17ea64c258b` |

Receipts pin **tested** SHAs. The documentation commit that publishes this report is not a new test run.

Prior WP6 implementation commits already on `origin/main` (not re-authored here):

| Repo | Commit | Subject |
| --- | --- | --- |
| AbrChin | `96663b17514b020ef1d25cf04da7f2dd601534ce` | `test(wp6): add release-truth gates and retire stale launch claims` |
| AbrChin | `4252c69` | `fix(wp6): isolate required release gates and pin file-secret compose` |
| AbrChin | `0c08c89bb60ae6066133eb73d4303a4abefb2aac` | `fix(sale): map disabled Arvan to Persian fail-closed wallet errors` |
| AbrChin | `bf9ce360de86b65ef4481f1da438614a67edbaff` | `docs(wp6): publish READY_FOR_OWNER_TEST receipts without production auth` |
| AbrChin | `991f62530301d099a7c7d16a7ca4e51d22307dfb` | `docs(wp6): close readiness table row and keep cross-repo pointer` |
| MessageGo | `4d473393657403fd0cdd17dbba66a31d62c4c2fb` | `docs(wp6): retract ready_for_first_production_deployment claim` |
| MessageGo | `c869a677607567b952d8598f97cf8adeeb3932b3` | `fix(wp6): timestamptz replay precision and patched govulncheck deps` |
| MessageGo | `c822352d555d9f5c8bef4e52e676c17ea64c258b` | `docs(wp6): pin release-truth evidence and keep production denied` |

Canonical receipts:

- `docs/launch/wp6-release-truth.md`
- `docs/launch/evidence/wp6/receipt.json`
- `docs/launch/evidence/wp6/receipt.md`
- MessageGo `docs/program/wp6-release-truth-pointer.md`
- Unsigned checklist: `docs/launch/wp6-owner-acceptance-checklist.md`

Command: `npm run test:wp6`

Started: `2026-09-01T23:09:12.231Z`
Ended: `2026-09-01T23:13:47.512Z`

Totals: pass=1782 fail=0 skip=0. Required gates=70, all `pass`. Required skip = NO-GO; none skipped.

## Changed files this re-run

AbrChin versus `bf9ce36`:

- `docs/launch/release-readiness-v2.md`
- `scripts/wp6-release-truth.mts`
- `docs/launch/evidence/wp6/receipt.json`
- `docs/launch/evidence/wp6/receipt.md`
- `docs/launch/wp6-release-truth.md`
- `docs/launch/wp6-cross-repo-release-report.md`
- `docs/launch/wp6-owner-acceptance-checklist.md`

MessageGo versus `c822352`:

- `docs/program/wp6-release-truth-pointer.md`
- `docs/program/messagego-v2-program-state.json`

No Prisma or MessageGo SQL migration files were added in this re-run.
MessageGo `internal/labui/dist` rebuild churn was discarded and not committed.

## Migration status

| Tree | Count | Apply in this run | Production apply |
| --- | --- | --- | --- |
| AbrChin `prisma/migrations` | 59 forward-only directories | local test databases only | **not executed** |
| MessageGo `migrations/*.sql` | 28 files (`000001`–`000028`) | local `messagego_wp6` / `messagego_m6_wp6` only | **not executed** |

Historical Launch V2 notes of “53/54 migrations” are dated 2026-08-10 artifacts.
`PENDING_PHASE_COMMIT` remains retired. Publication branch is `origin/main`.

Isolated restore: pass (`abrchin-backup-restore`, `messagego-backup-restore`).
Production restore: **not performed**.

## Environment (local production-candidate)

- PostgreSQL 16.15 at `127.0.0.1:5432` (real)
- Redis 7.0.15 at `127.0.0.1:6379` (real)
- NATS 2.10.7 JetStream at `nats://127.0.0.1:4222` (real)
- Node v22.22.2
- Go toolchain `go1.25.13` (module `go 1.25.0`, `toolchain go1.25.13`)
- Docker daemon down; `docker compose config` validated without starting containers
- Payment/SMS/SMTP adapters: MOCK / console / console
- `ARVAN_ENABLED=false`, `ARVAN_MUTATIONS_ENABLED=false`, `CRX_PROVIDER_TRAFFIC_ENABLED=false`
- `MESSAGEGO_SETTLEMENT_ENABLED`, `MESSAGEGO_CUSTOMER_AI_ENABLED`, `MESSAGEGO_SECRET_HANDOFF_ENABLED` remain false

## Complete test table

| Gate | Repo | Status | pass/fail/skip | Command |
| --- | --- | --- | --- | --- |
| `abrchin-install` | `abrchin` | `pass` | 1/0/0 | `node -e` install-ok |
| `abrchin-prisma-generate` | `abrchin` | `pass` | 1/0/0 | `npx prisma generate` |
| `abrchin-lint` | `abrchin` | `pass` | 1/0/0 | `npm run lint` |
| `abrchin-typecheck` | `abrchin` | `pass` | 1/0/0 | `npm run typecheck` |
| `abrchin-unit-auth` | `abrchin` | `pass` | 74/0/0 | `npm run test:auth` |
| `abrchin-unit-wallet` | `abrchin` | `pass` | 6/0/0 | `npm run test:wallet` |
| `abrchin-unit-billing-policy` | `abrchin` | `pass` | 11/0/0 | `npm run test:billing-policy` |
| `abrchin-unit-customer-navigation` | `abrchin` | `pass` | 35/0/0 | `npm run test:customer-navigation` |
| `abrchin-unit-connection-check` | `abrchin` | `pass` | 15/0/0 | `npm run test:connection-check` |
| `abrchin-unit-payments` | `abrchin` | `pass` | 8/0/0 | `npm run test:payments` |
| `abrchin-unit-account-admin` | `abrchin` | `pass` | 10/0/0 | `npm run test:account-admin` |
| `abrchin-unit-providers` | `abrchin` | `pass` | 43/0/0 | `npm run test:providers` |
| `abrchin-profit-curve` | `abrchin` | `pass` | 27/0/0 | `npm run test:profit-curve` |
| `abrchin-accounting` | `abrchin` | `pass` | 17/0/0 | `npm run test:accounting` |
| `abrchin-recommendation` | `abrchin` | `pass` | 55/0/0 | `npm run test:recommendation` |
| `abrchin-launch-gates` | `abrchin` | `pass` | 9/0/0 | `npm run test:launch-gates` |
| `abrchin-phase1-discovery` | `abrchin` | `pass` | 3/0/0 | `npm run test:phase1-discovery` |
| `abrchin-phase2-guest-auth` | `abrchin` | `pass` | 4/0/0 | `npm run test:phase2-guest-auth` |
| `abrchin-phase3-contract` | `abrchin` | `pass` | 16/0/0 | `npm run test:phase3-contract` |
| `abrchin-phase4-tracking` | `abrchin` | `pass` | 3/0/0 | `npm run test:phase4-tracking` |
| `abrchin-phase5-contract` | `abrchin` | `pass` | 7/0/0 | `npm run test:phase5-contract` |
| `abrchin-phase6-contract` | `abrchin` | `pass` | 15/0/0 | `npm run test:phase6-contract` |
| `abrchin-phase7-parchin` | `abrchin` | `pass` | 22/0/0 | `npm run test:phase7-parchin` |
| `abrchin-phase8-contract` | `abrchin` | `pass` | 14/0/0 | `npm run test:phase8-contract` |
| `abrchin-phase9-readiness` | `abrchin` | `pass` | 6/0/0 | `npm run test:phase9-readiness` |
| `abrchin-legal-content` | `abrchin` | `pass` | 6/0/0 | `npm run test:legal-content` |
| `abrchin-infrastructure` | `abrchin` | `pass` | 86/0/0 | `npm run test:infrastructure` |
| `abrchin-migration-safety` | `abrchin` | `pass` | 19/0/0 | `npm run test:migration-safety` |
| `abrchin-production-build` | `abrchin` | `pass` | 1/0/0 | `npm run build` |
| `abrchin-worker-runtime` | `abrchin` | `pass` | 9/0/0 | `npm run test:worker-runtime` |
| `abrchin-panel-role-e2e` | `abrchin` | `pass` | 1/0/0 | `npm run test:panel-role-e2e-isolated` |
| `abrchin-smoke` | `abrchin` | `pass` | 1/0/0 | `npm run test:smoke` |
| `abrchin-git-diff-check` | `abrchin` | `pass` | 1/0/0 | `git diff --check` |
| `abrchin-postgres-migration` | `abrchin` | `pass` | 1/0/0 | `npm run test:postgres` |
| `abrchin-fresh-migration` | `abrchin` | `pass` | 1/0/0 | `npm run test:fresh-migration` |
| `abrchin-migration-upgrade` | `abrchin` | `pass` | 1/0/0 | `npm run test:migration-upgrade` |
| `abrchin-identity-migration` | `abrchin` | `pass` | 1/0/0 | `npm run test:identity-migration` |
| `abrchin-parspack-history` | `abrchin` | `pass` | 1/0/0 | `npm run test:parspack-history` |
| `abrchin-settlement-history` | `abrchin` | `pass` | 1/0/0 | `npm run test:wp5-settlement-history` |
| `abrchin-phase3-postgres` | `abrchin` | `pass` | 13/0/0 | `npm run test:wp5-phase3-postgres` |
| `abrchin-phase5-postgres` | `abrchin` | `pass` | 3/0/0 | `npm run test:wp5-phase5-postgres` |
| `abrchin-phase6-postgres` | `abrchin` | `pass` | 1/0/0 | `npm run test:phase6-postgres` |
| `abrchin-phase7-postgres` | `abrchin` | `pass` | 1/0/0 | `npm run test:phase7-postgres` |
| `abrchin-financial-postgres` | `abrchin` | `pass` | 1/0/0 | `npm run test:financial-postgres` |
| `abrchin-accounting-postgres` | `abrchin` | `pass` | 7/0/0 | `npm run test:accounting-isolated` |
| `abrchin-messagego-integration` | `abrchin` | `pass` | 4/0/0 | `npm run test:messagego-v2-release-readiness` |
| `abrchin-backup-restore` | `abrchin` | `pass` | 5/0/0 | `npm run test:ops-wp3` |
| `abrchin-secret-scan` | `abrchin` | `pass` | 1/0/0 | `npm run test:secret-scan` |
| `abrchin-npm-audit` | `abrchin` | `pass` | 1/0/0 | `npm audit --omit=dev --audit-level=low` |
| `abrchin-compose-validate` | `abrchin` | `pass` | 1/0/0 | `docker compose … -f compose.production.yaml config --quiet` |
| `messagego-fmt-check` | `messagego` | `pass` | 1/0/0 | `make fmt-check` |
| `messagego-vet` | `messagego` | `pass` | 1/0/0 | `make vet` |
| `messagego-unit` | `messagego` | `pass` | 518/0/0 | `go test -json -count=1 ./...` |
| `messagego-race` | `messagego` | `pass` | 518/0/0 | `go test -json -count=1 -race ./...` |
| `messagego-postgres-integration` | `messagego` | `pass` | 18/0/0 | `go test -tags=integration ./internal/adapters/postgres` |
| `messagego-m6-postgres-integration` | `messagego` | `pass` | 55/0/0 | `go test -tags=integration ./internal/m6bootstrap` |
| `messagego-redis-up` | `messagego` | `pass` | 1/0/0 | Redis limiter atomic/product-isolated |
| `messagego-redis-down` | `messagego` | `pass` | 1/0/0 | Redis unavailable fails closed |
| `messagego-nats-up` | `messagego` | `pass` | 1/0/0 | JetStream stable event-id dedupe |
| `messagego-nats-down` | `messagego` | `pass` | 1/0/0 | NATS unavailable fails closed |
| `messagego-contracts` | `messagego` | `pass` | 1/0/0 | `make contract-test` |
| `messagego-clients` | `messagego` | `pass` | 1/0/0 | `make client-test` |
| `messagego-release-check` | `messagego` | `pass` | 1/0/0 | `make release-check` |
| `messagego-settlement-contract` | `messagego` | `pass` | 1/0/0 | `make v2-settlement-contract-check` |
| `messagego-provider-registry` | `messagego` | `pass` | 1/0/0 | `make v2-provider-registry-check` |
| `messagego-policy-selector` | `messagego` | `pass` | 1/0/0 | `make v2-policy-selector-check` |
| `messagego-v2-packages` | `messagego` | `pass` | 86/0/0 | settlement/billing/integration/providers/s2s/secrets unit |
| `messagego-govulncheck` | `messagego` | `pass` | 1/0/0 | `govulncheck ./...` (`GOTOOLCHAIN=go1.25.13`) |
| `messagego-compose-validate` | `messagego` | `pass` | 1/0/0 | `docker compose -f deployments/single-server/docker-compose.yml config --quiet` |
| `messagego-backup-restore` | `messagego` | `pass` | 1/0/0 | `bash ops/wp3-backup-test.sh` |

Exact commands, timestamps, and log tails for failures (none) are in
`docs/launch/evidence/wp6/receipt.json`.

## Dependency audit

| Gate | Result |
| --- | --- |
| `npm audit --omit=dev --audit-level=low` | pass (0 production-omit-dev vulnerabilities; `deepmerge-ts` override 8.0.1) |
| `govulncheck ./...` | pass: 0 called vulnerabilities |
| Secret scan | pass |
| Compose config (AbrChin + MessageGo) | pass without daemon |

`govulncheck` also reported 0 imported-package vulnerabilities and 17
vulnerabilities in required modules that the scan did not show as called.
Those uncalled findings are residual, not a gate fail.

## Remaining warnings

- Docker daemon was down. Compose validation used `docker compose config` without starting containers.
- Owner acceptance is still unsigned. Production remains unauthorized.
- Legal identity fields in `docs/launch/legal-entity-blocker.md` are empty; public legal pages stay draft/noindex.
- Production backup restore was not performed.
- Staging purchase, on-call capacity, and Founder deploy authorization remain external blockers (`docs/launch/release-readiness-v2.md`).
- `govulncheck` residual uncalled module-graph findings (17) are not treated as called production vulns.

## Operational requirements (not satisfied by this receipt)

- Founder-authorized staging host with real PostgreSQL, OTP/SMTP/gateway, and read-only Arvan checks
- Human on-call for Parchin / P1
- Official legal entity fields
- Production backup destination separate from data root; restore drill on that host
- Fail-closed gates remain false until a later Owner document says otherwise:
  `MESSAGEGO_SETTLEMENT_ENABLED`, `MESSAGEGO_CUSTOMER_AI_ENABLED`,
  `MESSAGEGO_SECRET_HANDOFF_ENABLED`, `CRX_PROVIDER_TRAFFIC_ENABLED`,
  `ARVAN_MUTATIONS_ENABLED`
- MessageGo production defaults remain `"false"` for `CRX_AUTO_MIGRATE`,
  `CRX_AI_ENABLED`, `CRX_PROVIDER_TRAFFIC_ENABLED`, `CRX_S2S_REPLAY_STORE_ENABLED`

## Exact manual owner test steps

Do not mark the checklist accepted until Mohammad signs
`docs/launch/wp6-owner-acceptance-checklist.md`.

1. Desktop `1440×900`: `/`, catalog, quote, wallet, order.
2. Mobile `390×844`: same routes.
3. Admin publishes one selected Arvan SKU with markup; confirm it is not auto-publish of the raw catalog.
4. Buy PREPAID 1, 3, 6, and 12 months (guest quote → login/claim → wallet debit).
5. Top up the AbrChin wallet through the configured gateway; confirm a single ledger credit under retry.
6. Confirm the order debit is atomic (no double debit).
7. First Admin approval (provision/funding). Payment must not provision by itself.
8. Record manual fulfillment against that order only.
9. Second Admin approval (delivery).
10. Customer reveals credentials only after approval 2; secrets absent from logs.
11. On an Owner-approved environment, execute MessageGo via `POST /v1/ai/execute`.
12. Confirm usage/settlement posts to the AbrChin wallet only.
13. Cancel/refund copy matches the ledger.
14. Review isolated restore evidence; do not restore production.
15. Confirm health/readiness and worker heartbeat on the intended hosts.
16. Supply legal identity fields; until then pages remain draft.
17. Confirm only evidence-backed Parchin levels are sold.
18. Review rollback; never `docker compose down -v` or `prisma migrate reset`.

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
was config-validated only. Do not run production `up`. Keep:

```bash
# NOT EXECUTED — shown for Owner review only
# CRX_AUTO_MIGRATE=false
# CRX_AI_ENABLED=false
# CRX_PROVIDER_TRAFFIC_ENABLED=false
# CRX_S2S_REPLAY_STORE_ENABLED=false
docker compose --env-file deployments/single-server/.env \
  -f deployments/single-server/docker-compose.yml config --quiet
```

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
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness
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
