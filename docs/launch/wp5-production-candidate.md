# WP5 production-candidate receipt

Tied SHAs:

- AbrChin: `eb159071bcf8268456c139d97dbd81dc17d5ace0`
- MessageGo: `026ab2f47f1b327de33938d55bf7ddcb7886b6ee`

```text
verdict = READY_FOR_OWNER_TEST
owner_acceptance = false
production_authorized = false
provider_traffic_authorized = false
```

Started: `2026-09-01T22:09:07.286Z`
Ended: `2026-09-01T22:11:35.055Z`

## Environment topology

- PostgreSQL: `postgres (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)` at `127.0.0.1:5432` listening=true
- Redis: `Redis server v=7.0.15 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64 build=e53ff17674aa6190` at `127.0.0.1:6379` listening=true
- NATS: `nats-server: v2.10.7` at `nats://127.0.0.1:4222` listening=true
- Node: `v22.14.0`
- Go: `go version go1.22.2 linux/amd64`
- Docker daemon: `down`
- Payment/SMS/SMTP adapters: MOCK / console / console
- Live Arvan mutations: false
- Live provider traffic: false

## Migration versions

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

## Gate results

| Gate | Repo | Status | pass/fail/skip | Command |
| --- | --- | --- | --- | --- |
| `wp5-golden-path` | `abrchin` | `pass` | 5/0/0 | `npm run test:wp5-golden-path` |
| `wp5-runtime` | `abrchin` | `pass` | 3/0/0 | `npm run test:wp5-runtime` |
| `wp5-settlement-history` | `abrchin` | `pass` | 1/0/0 | `npm run test:wp5-settlement-history` |
| `fresh-migration` | `abrchin` | `pass` | 1/0/0 | `npm run test:fresh-migration` |
| `migration-upgrade` | `abrchin` | `pass` | 1/0/0 | `npm run test:migration-upgrade` |
| `parspack-history` | `abrchin` | `pass` | 1/0/0 | `npm run test:parspack-history` |
| `ops-wp3-backup` | `abrchin` | `pass` | 5/0/0 | `npm run test:ops-wp3` |
| `sellable-pricing-policy` | `abrchin` | `pass` | 3/0/0 | `node --import ./scripts/test-resolve-hook.mjs --experimental-strip-types --test scripts/sellable-pricing-policy-test.mts` |
| `failure-recovery-policy` | `abrchin` | `pass` | 3/0/0 | `node --import ./scripts/test-resolve-hook.mjs --experimental-strip-types --test scripts/failure-recovery-policy-test.mts` |
| `wp5-phase3-postgres` | `abrchin` | `pass` | 13/0/0 | `npm run test:wp5-phase3-postgres` |
| `wp5-phase5-postgres` | `abrchin` | `pass` | 3/0/0 | `npm run test:wp5-phase5-postgres` |
| `messagego-settlement-unit` | `abrchin` | `pass` | 7/0/0 | `npm run test:messagego-v2-settlement` |
| `messagego-settlement-postgres` | `abrchin` | `pass` | 7/0/0 | `npm run test:wp5-settlement-postgres` |
| `messagego-integration-unit` | `abrchin` | `pass` | 6/0/0 | `npm run test:messagego-v2-integration` |
| `messagego-integration-postgres` | `abrchin` | `pass` | 2/0/0 | `npm run test:wp5-integration-postgres` |
| `messagego-preprod-hmac` | `abrchin` | `pass` | 7/0/0 | `npm run test:messagego-v2-preprod` |
| `messagego-preprod-postgres` | `abrchin` | `pass` | 4/0/0 | `npm run test:messagego-v2-preprod-postgres` |
| `messagego-fmt-check` | `messagego` | `pass` | 1/0/0 | `make fmt-check` |
| `messagego-vet` | `messagego` | `pass` | 1/0/0 | `make vet` |
| `messagego-unit` | `messagego` | `pass` | 518/0/0 | `go test -json -count=1 ./...` |
| `messagego-race` | `messagego` | `pass` | 518/0/0 | `go test -json -count=1 -race ./...` |
| `messagego-wp09-cross` | `messagego` | `pass` | 17/0/0 | `go test -json -count=1 -tags=wp09cross -timeout 180s ./internal/v2integration` |
| `messagego-redis-up` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 60s -run ^TestRedisLimiterIsAtomicAndProductIsolated$ ./internal/adapters/redislimit` |
| `messagego-redis-down` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 30s -run ^TestRedisUnavailableFailsClosed$ ./internal/adapters/redislimit` |
| `messagego-nats-up` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 60s -run ^TestJetStreamDeduplicatesStableEventID$ ./internal/adapters/natsjs` |
| `messagego-nats-down` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -tags=integration -timeout 30s -run ^TestNATSUnavailableFailsClosed$ ./internal/adapters/natsjs` |
| `messagego-hmac-matrix` | `messagego` | `pass` | 16/0/0 | `go test -json -count=1 -timeout 60s -run ^(TestHMACFailureMatrix|TestDuplicateNonceRejected)$ ./internal/v2s2s` |
| `messagego-dispatch-fail` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -timeout 60s -run ^TestReserveSucceedsDispatchFailsKeepsHold$ ./internal/v2integration` |
| `messagego-api-restart` | `messagego` | `pass` | 1/0/0 | `go test -json -count=1 -timeout 180s -run ^TestAPIProcessRestartKeepsLive$ ./internal/v2runtime` |

Totals: pass=1149 fail=0 skip=0

## Required scenario coverage

| Scenario | Status |
| --- | --- |
| `prepaid_1_month` | `pass` |
| `prepaid_3_months` | `pass` |
| `prepaid_6_months` | `pass` |
| `prepaid_12_months` | `pass` |
| `admin_publish_priced_arvan_plan` | `pass` |
| `customer_quote` | `pass` |
| `quote_price_and_expiry` | `pass` |
| `wallet_topup_mock_gateway` | `pass` |
| `idempotent_gateway_callback` | `pass` |
| `atomic_wallet_debit` | `pass` |
| `admin_approval_1` | `pass` |
| `manual_fulfillment` | `pass` |
| `admin_approval_2` | `pass` |
| `secure_credential_delivery` | `pass` |
| `financial_audit_reconcile` | `pass` |
| `insufficient_wallet` | `pass` |
| `expired_quote` | `pass` |
| `missing_price` | `pass` |
| `one_rial_placeholder` | `pass` |
| `zero_placeholder` | `pass` |
| `unpublished_plan` | `pass` |
| `customer_publication_attempt` | `pass` |
| `direct_order_payment` | `pass` |
| `duplicate_gateway_callback` | `pass` |
| `duplicate_order_submission` | `pass` |
| `concurrent_wallet_debit` | `pass` |
| `worker_restart` | `pass` |
| `abrchin_restart` | `pass` |
| `messagego_restart` | `pass` |
| `redis_failure` | `pass` |
| `nats_failure` | `pass` |
| `postgres_interruption` | `pass` |
| `provider_timeout` | `pass` |
| `unknown_provider_usage` | `pass` |
| `duplicate_s2s_nonce` | `pass` |
| `stale_s2s_timestamp` | `pass` |
| `invalid_hmac` | `pass` |
| `settlement_timeout` | `pass` |
| `reserve_succeeds_dispatch_fails` | `pass` |
| `dispatch_succeeds_settlement_lost` | `pass` |
| `idempotent_ai_retry` | `pass` |
| `readonly_token_ai_execute` | `pass` |
| `backup_restore` | `pass` |
| `fresh_migration` | `pass` |
| `upgrade_prior_schema` | `pass` |
| `parspack_history_upgrade` | `pass` |
| `wallet_settlement_history_upgrade` | `pass` |

## Restore verification

```json
{
  "gate": "ops-wp3-backup",
  "status": "pass",
  "production_restore": false,
  "isolated_restore_required": true,
  "skipped": false
}
```

## Financial invariants

```json
{
  "integer_rial_only": true,
  "floating_point_money": false,
  "wallet_credits_minus_debits_equals_balance": "asserted_in_wp5-golden-path",
  "topup_ledger_once_per_intent": "asserted_in_wp5-golden-path",
  "order_debit_once": "asserted_in_wp5-golden-path",
  "settlement_history_net_equals_wallet": "asserted_in_wp5-settlement-history",
  "secrets_in_receipts": false
}
```

A skipped required test is `NO-GO`. This receipt does not set owner acceptance
or production authorization.
