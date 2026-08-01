# Production deployment

## Compose
`compose.production.yaml` runs:
- `db` Postgres 16 (private network, persistent volume `abrchin_pg_data`)
- `web` Next standalone image with migrate-on-start entrypoint
- `worker` provisioning and subscription lifecycle worker with a heartbeat healthcheck

## Bootstrap
1. Copy `.env.production.example` to `.env` in the project root and fill secrets.
2. Export the file before bootstrap: `set -a; source .env; set +a`.
3. Run `./ops/bootstrap-production.sh`

## Migrations
Production uses `prisma migrate deploy` only (via Docker entrypoint).

## Backup
`./ops/backup-postgres.sh` creates gzipped `pg_dump` files and keeps 7 days.
Optional remote sync can be added with rclone after the dump.

## Required secrets
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `SESSION_SECRET`
- `CREDENTIAL_ENCRYPTION_KEY` (exactly 32 random bytes, Base64 encoded)
- `KAVENEGAR_API_KEY` (when SMS_PROVIDER=kavenegar)
- `ZIBAL_MERCHANT` (default Production gateway)
- `ZARINPAL_MERCHANT_ID` (optional alternate gateway)
- `PAYMENT_CALLBACK_BASE_URL`
- `ADMIN_MOBILES`
- `PARSPACK_API_TOKEN` (when `PARSPACK_ENABLED=true`)
- `ARVAN_API_KEY` (when `ARVAN_ENABLED=true`; server-side only)
- `PARSPACK_PRICE_CURRENCY` and `PARSPACK_PRICE_AMOUNT_UNIT` only after the
  provider price contract is explicitly verified. Without them pricing fails closed.

After migration, an admin must run Catalog Sync, inspect unmapped plans, set the
Provider and Product Markup, Tax BPS and every Parchin price, and only then
activate sellable plans. Keep `ARVAN_MUTATIONS_ENABLED=false`; the migration and
Catalog Sync are read-only and never create Provider resources.

Keep every sale and mutation gate disabled until its separate Founder check:

```text
PARSPACK_PUBLIC_SALE_ENABLED=false
PARSPACK_MUTATIONS_ENABLED=false
ARVAN_PUBLIC_SALE_ENABLED=false
ARVAN_READY_PUBLIC_SALE_ENABLED=false
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=false
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=false
```

Public-sale and product gates are checked again before every wallet debit.
Provider-backed plans also require the matching Mutation gate and successful
provider revalidation. Manual and pre-provisioned inventory use the independent
Manual gate; a pre-provisioned Resource still requires a fresh observation,
health result and unique encrypted `READY` credential. Registering catalog or
inventory does not turn public sales on.

## Health endpoints

- `/api/health` is a lightweight web-container liveness check used by Compose.
- `/api/readiness` checks the database and the latest provisioning-worker heartbeat.
  External monitoring should use this endpoint and alert on HTTP 503.
- `/status` is the public, customer-safe view of the same platform readiness.

These endpoints report AbrChin platform health. They do not imply per-customer VM
monitoring, scheduled backups, or operating-system maintenance.
