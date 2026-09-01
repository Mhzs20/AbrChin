# WP6 release-truth receipt

Tied SHAs:

- AbrChin: `991f62530301d099a7c7d16a7ca4e51d22307dfb`
- MessageGo: `c822352d555d9f5c8bef4e52e676c17ea64c258b`

```text
verdict = READY_FOR_OWNER_TEST
owner_acceptance = false
owner_accepted = false
production_authorized = false
provider_traffic_authorized = false
READY_FOR_FIRST_PRODUCTION_DEPLOYMENT = NO
PRODUCTION NOT AUTHORIZED
LIVE PROVIDER TRAFFIC NOT AUTHORIZED
```

Started: `2026-09-01T23:09:12.231Z`
Ended: `2026-09-01T23:13:47.512Z`

## Environment topology

- PostgreSQL: `postgres (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)` at `127.0.0.1:5432` listening=true
- Redis: `Redis server v=7.0.15 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64 build=e53ff17674aa6190` at `127.0.0.1:6379` listening=true
- NATS: `nats-server: v2.10.7` at `nats://127.0.0.1:4222` listening=true
- Node: `v22.22.2`
- Go: `go version go1.25.13 linux/amd64`
- Docker daemon: `down`
- Docker Compose: `Docker Compose version 2.40.3+ds1-0ubuntu1~24.04.1`
- Payment/SMS/SMTP adapters: MOCK / console / console
- Live Arvan mutations: false
- Live provider traffic: false

## AbrChin Prisma migrations (59)

- `20260725120000_init_auth`
- `20260725180000_wallet_ledger_payments`
- `20260725190000_payment_gateways`
- `20260726000000_wallet_topup_suggestions`
- `20260726120000_infrastructure`
- `20260726140000_hardening_funding_ledger`
- `20260726180000_production_provisioning`
- `20260728233000_quick_cloud_checkout`
- `20260729100000_recommendation_quotes`
- `20260729110000_secure_instance_credentials`
- `20260729120000_service_subscriptions`
- `20260729200000_parspack_catalog_pricing`
- `20260730160000_multi_provider_routing`
- `20260730190000_provider_review_hardening`
- `20260730223000_provider_review_recovery_v2`
- `20260730234500_terminal_order_recovery`
- `20260731003000_multi_order_terminal_recovery_v4`
- `20260731043000_terminal_and_worker_recovery_v5`
- `20260731120000_terminal_and_dispatch_recovery_v6`
- `20260731200000_health_dispatch_starvation_recovery_v7`
- `20260801120000_admin_catalog_resilience`
- `20260801210000_preprovisioned_inventory_safety`
- `20260801230000_arvan_sale_inventory_credentials`
- `20260801235900_final_launch_routing`
- `20260803100000_service_connection_checks`
- `20260803113000_sku_markup_and_manual_publication`
- `20260803130000_order_gateway_payments`
- `20260803150000_wallet_payg_billing_core`
- `20260803160000_wallet_payment_recovery`
- `20260803170000_usage_billing_worker`
- `20260803180000_wallet_first_activation`
- `20260803190000_provider_billing_contract_gate`
- `20260803200000_billing_runtime_safety`
- `20260804110000_catalog_sync_pricing_fail_closed`
- `20260804140000_storefront_chinish_assortment`
- `20260804150000_storefront_auto_suggest`
- `20260804160000_storefront_capacity_rules`
- `20260804170000_launch_markup_and_catalog_defaults`
- `20260804180000_launch_parchin_lifecycle`
- `20260804190000_launch_term_coupons_lifecycle`
- `20260804200000_compass_service_prices`
- `20260806120000_storefront_price_display_flags`
- `20260806130000_storefront_price_bands_style`
- `20260806140000_provider_region_discovery`
- `20260806150000_user_account_status`
- `20260806200000_commercial_pricing_v3`
- `20260806210000_storefront_dominance_parchin_v3`
- `20260807010000_profit_curve_operational_accounting`
- `20260807020000_operating_expense_draft_idempotency`
- `20260807130000_rate_limit_bucket_and_payg_repair`
- `20260807140000_support_requests`
- `20260807150000_customer_identity_email_verification`
- `20260808230000_parchin_operational_contract_v2`
- `20260810220000_parchin_operations_v3`
- `20260822090000_drop_parspack_provider`
- `20260826100000_messagego_v2_wallet_authority`
- `20260827120000_messagego_v2_s2s_replay`
- `20260901120000_messagego_customer_pricing`
- `20260901230000_parspack_history_archive`

## MessageGo SQL migrations (28)

- `000001_foundation.sql`
- `000002_milestone_one.sql`
- `000003_row_level_isolation.sql`
- `000004_realtime_blocks.sql`
- `000005_models_usage_quotas.sql`
- `000006_ai_runs.sql`
- `000007_ai_admin.sql`
- `000008_ai_admin_queries.sql`
- `000009_provider_usage_reconciliation.sql`
- `000010_base_routing_profiles.sql`
- `000011_runtime_routing_and_invocation.sql`
- `000012_reconciliation_settlement_permissions.sql`
- `000013_abrchin_billing_authority.sql`
- `000014_production_provider_budgets.sql`
- `000015_provider_isolated_routing_profiles.sql`
- `000016_client_tool_foundation.sql`
- `000017_versioned_provider_pricing.sql`
- `000018_tenant_integrations_and_tool_events.sql`
- `000019_nahira_contract_hardening.sql`
- `000020_conversation_lifecycle.sql`
- `000021_rich_content_assets.sql`
- `000022_memory_tool_recovery.sql`
- `000023_provider_routing_security.sql`
- `000024_accounting_attribution.sql`
- `000025_v2_preprod.sql`
- `000026_messagego_public_execute.sql`
- `000027_wp2_billing_idempotency.sql`
- `000028_wp3_ops_readiness.sql`

## Gate results

| Gate | Repo | Status | pass/fail/skip | Command |
| --- | --- | --- | --- | --- |
| `abrchin-install` | `abrchin` | `pass` | 1/0/0 | `node -e require('fs').accessSync('node_modules/next'); require('fs').accessSync('node_modules/@prisma/client'); console.log('install-ok')` |
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
| `abrchin-compose-validate` | `abrchin` | `pass` | 1/0/0 | `docker compose --env-file /tmp/wp6-abrchin-compose-427ff803.env -f compose.production.yaml config --quiet` |
| `messagego-fmt-check` | `messagego` | `pass` | 1/0/0 | `make fmt-check` |
| `messagego-vet` | `messagego` | `pass` | 1/0/0 | `make vet` |
| `messagego-unit` | `messagego` | `pass` | 518/0/0 | `go test -json -count=1 ./...` |
| `messagego-race` | `messagego` | `pass` | 518/0/0 | `go test -json -count=1 -race ./...` |
| `messagego-postgres-integration` | `messagego` | `pass` | 18/0/0 | `go test -json -count=1 -tags=integration -timeout 10m ./internal/adapters/postgres` |
| `messagego-m6-postgres-integration` | `messagego` | `pass` | 55/0/0 | `go test -json -count=1 -tags=integration -timeout 10m ./internal/m6bootstrap` |
| `messagego-redis-up` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 60s -run ^TestRedisLimiterIsAtomicAndProductIsolated$ ./internal/adapters/redislimit` |
| `messagego-redis-down` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 30s -run ^TestRedisUnavailableFailsClosed$ ./internal/adapters/redislimit` |
| `messagego-nats-up` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 60s -run ^TestJetStreamDeduplicatesStableEventID$ ./internal/adapters/natsjs` |
| `messagego-nats-down` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 30s -run ^TestNATSUnavailableFailsClosed$ ./internal/adapters/natsjs` |
| `messagego-contracts` | `messagego` | `pass` | 1/0/0 | `make contract-test` |
| `messagego-clients` | `messagego` | `pass` | 1/0/0 | `make client-test` |
| `messagego-release-check` | `messagego` | `pass` | 1/0/0 | `make release-check` |
| `messagego-settlement-contract` | `messagego` | `pass` | 1/0/0 | `make v2-settlement-contract-check` |
| `messagego-provider-registry` | `messagego` | `pass` | 1/0/0 | `make v2-provider-registry-check` |
| `messagego-policy-selector` | `messagego` | `pass` | 1/0/0 | `make v2-policy-selector-check` |
| `messagego-v2-packages` | `messagego` | `pass` | 86/0/0 | `go test -json -count=1 ./internal/adapters/v2settlement ./internal/v2billing ./internal/v2integration ./internal/v2providers ./internal/v2s2s ./internal/v2secrets` |
| `messagego-govulncheck` | `messagego` | `pass` | 1/0/0 | `govulncheck ./...` |
| `messagego-compose-validate` | `messagego` | `pass` | 1/0/0 | `docker compose -f deployments/single-server/docker-compose.yml config --quiet` |
| `messagego-backup-restore` | `messagego` | `pass` | 1/0/0 | `bash ops/wp3-backup-test.sh` |

Totals: pass=1782 fail=0 skip=0

## Restore verification

```json
{
  "messagego_wp3_backup": "pass",
  "abrchin_ops_wp3_in_infrastructure": "pass",
  "production_restore": false,
  "isolated_restore_required": true,
  "skipped": false
}
```

## Remaining warnings

- Docker daemon was down. Compose validation used `docker compose config` without starting containers.
- Owner acceptance is still unsigned. Production remains unauthorized.

A skipped required test is `NO-GO`. This receipt does not set owner
acceptance or production authorization.
