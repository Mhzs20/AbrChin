# Production deployment

## Compose
`compose.production.yaml` runs:
- `db` Postgres 16 (private network, persistent volume `abrchin_pg_data`)
- `web` Next standalone image with migrate-on-start entrypoint

## Bootstrap
1. Copy `.env.production.example` and fill secrets.
2. Export required env vars.
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
- `KAVENEGAR_API_KEY` (when SMS_PROVIDER=kavenegar)
- `ZIBAL_MERCHANT` (default Production gateway)
- `ZARINPAL_MERCHANT_ID` (optional alternate gateway)
- `PAYMENT_CALLBACK_BASE_URL`
- `ADMIN_MOBILES`
