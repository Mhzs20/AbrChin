# Production deployment

> این سند فقط Runbook است. اجرای Deploy، Payment واقعی، Refund بانکی یا
> Provider Mutation نیازمند مجوز صریح Founder است.

## Compose

`compose.production.yaml` شامل:

- PostgreSQL 16 با Volume پایدار (بدون پورت عمومی)
- Next.js Web فقط روی `127.0.0.1:3010`
- Worker برای Provisioning، Billing Settlement، Dunning و Reconciliation
- Scheduler مستقل Read-only برای Catalog Sync؛ این Process هیچ Provisioning
  یا Provider Mutation اجرا نمی‌کند

همهٔ `web` / `worker` / `catalog-sync` باید همان Image immutable
`ABRCHIN_IMAGE` را داشته باشند.

## Environment contract

Production directory: `/opt/abrchin`

```text
APP_DIR=/opt/abrchin
ENV_FILE=.env
COMPOSE_FILE=compose.production.yaml
ABRCHIN_IMAGE=abrchin:<immutable-sha>
DEPLOY_IMAGE_SOURCE=local|registry   # default: local
BACKUP_BEFORE_DEPLOY=1|0             # default: 1
```

هر فرمان Compose Production باید `--env-file "$ENV_FILE"` داشته باشد
(پیش‌فرض: `.env` — همان فایل واقعی هاست Production؛ ممکن است
`ENV_FILE=.env` باشد). `ops/deploy.sh` هرگز فایل env را با Bash `source`
نمی‌کند — dotenv ممکن است شامل مقادیری مثل `ARVAN_API_KEY=Apikey …`
باشد که برای Compose معتبرند ولی برای Shell نیستند. متغیرهای کنترل Deploy
باید صریحاً export شوند (`APP_DIR`, `ENV_FILE`, `COMPOSE_FILE`,
`ABRCHIN_IMAGE`, `DEPLOY_IMAGE_SOURCE`, `BACKUP_BEFORE_DEPLOY`).
Secretها را در Shell، Log یا Screenshot چاپ نکنید.

## Email verification (SMTP)

Production must send verification codes over SMTP (placeholders only in
`.env.production.example` — never commit real credentials). Runtime source of
truth remains the host env file (`/opt/abrchin/.env`):

```text
EMAIL_PROVIDER=smtp
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_TIMEOUT_MS=10000
EMAIL_VERIFICATION_TTL_SECONDS=600
```

## Migration contract

- Production فقط `prisma migrate deploy` را اجرا می‌کند.
- `prisma migrate dev` و `prisma migrate reset` ممنوع‌اند.
- Gate صریح Migration داخل `ops/deploy.sh` قبل از Start سرویس‌های App اجرا
  می‌شود (one-shot از همان Image کاندید، بدون Start کردن Next.js).
- Web entrypoint به‌صورت پیش‌فرض Migration را روی Restart عادی اجرا نمی‌کند
  (`ABRCHIN_RUN_MIGRATE_ON_START=false`). فقط برای Bootstrap/Recovery آن را
  `true` کنید.

## Deploy (canonical)

Default Founder procedure = local immutable image build on the server:

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

chmod +x ops/deploy.sh ops/backup-postgres.sh
./ops/deploy.sh
```

`ops/deploy.sh` sequence:

1. Acquire host deploy lock (`flock`)
2. Validate files / git / compose config
3. Build (local) or pull (registry) candidate image; inspect before touching app
4. Start/verify `db` only
5. PostgreSQL backup (when `BACKUP_BEFORE_DEPLOY=1`)
6. Explicit `prisma migrate deploy` one-shot
7. Start `web` + `worker` + `catalog-sync` on the same image
8. Local `/api/health` + `/api/readiness`
9. Public health/readiness/storefront checks
10. Verify all three app containers share `ABRCHIN_IMAGE`
11. Keep previous tagged image for rollback window (no aggressive prune)

Registry mode:

```bash
export DEPLOY_IMAGE_SOURCE="registry"
export ABRCHIN_IMAGE="ghcr.io/example/abrchin:<immutable-sha>"
./ops/deploy.sh
```

Never pull `:latest`.

## Profit Curve after deploy

Migration `20260807010000_profit_curve_operational_accounting` seeds
`ProfitCurveConfiguration(enabled=true)` with the five approved bands.
**New sales use the seeded Curve immediately after migrate deploy** — no
separate Founder publish is required for default activation.

Human Finance Center publish still requires typed confirmation
`تایید حاشیه بالا` when any margin ≥ 70%.

## Accounting backfill (explicit, post-health)

Do **not** run accounting backfill from app startup or DB migration.

After deploy health is green:

```bash
# Dry-run first (writes = 0). Use the same ENV_FILE as production deploy
# (/opt/abrchin/.env is the canonical host env file and the deploy default).
docker compose --env-file .env -f compose.production.yaml \
  exec -T web npm run accounting:backfill -- --dry-run
```

Review JSON: `recordsScanned`, `entriesToCreate`, `alreadyPosted`,
`needsReconciliation`, `errors`.

Only then:

```bash
docker compose --env-file .env -f compose.production.yaml \
  exec -T web npm run accounting:backfill
```

Second real run must create zero duplicates (`entriesToCreate=0`).

## Gateها

Launch: Sale باز، Mutation خاموش (Fulfillment دستی Admin):

```text
PUBLIC_SALE_ENABLED=true
ARVAN_PUBLIC_SALE_ENABLED=true
ARVAN_READY_PUBLIC_SALE_ENABLED=true
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=true
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=true
```

Do not turn Provider mutation on as part of deploy.

## Post-deploy read-only checks

```bash
cd /opt/abrchin
export ABRCHIN_IMAGE="abrchin:$(git rev-parse --short=12 HEAD)"

docker compose \
  --env-file .env \
  -f compose.production.yaml \
  ps db web worker catalog-sync

curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness

curl -fsS -o /dev/null https://abrchin.ir/api/health
curl -fsS -o /dev/null https://abrchin.ir/api/readiness
curl -fsS -o /dev/null https://abrchin.ir/cloud-servers
```

## Backup و Rollback

Encrypted `ops/backup-postgres.sh` قبل از Migration اجرا می‌شود.
`BACKUP_KEY_FILE` باید یک فایل 0600 با حداقل ۳۲ بایت باشد و `BACKUP_DIR`
نباید همان `DATA_ROOT` یا داخل آن باشد. Restore خودکار به Production انجام
نمی‌شود؛ `ops/restore-verify.sh` فقط یک PostgreSQL موقت می‌سازد.

Production deploy فقط readiness با HTTP 200 و `status=operational` را
می‌پذیرد. `degraded` پذیرفته نیست. شکست public health/readiness، migration،
worker یا smoke، deploy را با `FAILED at gate:` متوقف می‌کند و `SUCCESS`
چاپ نمی‌شود.
Rollback کد از Image قبلی انجام می‌شود؛ Database و Volume Reset نمی‌شوند.
هرگز:

```text
docker compose down -v
prisma migrate reset
```

این Release migrationها Additive و Forward-only هستند؛ Image قبلی معمولاً روی
Schema مهاجرت‌شده قابل اجرا است (جدول/ستون‌های جدید را نادیده می‌گیرد). اگر
Failure **قبل از Migration** باشد، deploy script Image قبلی را Restore می‌کند.
اگر Failure **بعد از Migration** باشد، auto-restore اجباری نیست؛ DB دست‌نخورده
می‌ماند و Founder باید Restore دستی Image یا Forward-fix را انتخاب کند.

Manual code rollback (DB preserved):

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

## Catalog Sync خواندنی

```bash
docker compose --env-file .env -f compose.production.yaml \
  exec -T web npm run sync:catalog:arvan
```

## Secret و Environment

- `POSTGRES_PASSWORD`, `DATABASE_URL`
- `SESSION_SECRET`
- `CREDENTIAL_ENCRYPTION_KEY`
- `KAVENEGAR_API_KEY` در صورت OTP واقعی
- `ZIBAL_MERCHANT` یا `ZARINPAL_MERCHANT_ID`
- `PAYMENT_CALLBACK_BASE_URL`
- `ADMIN_MOBILES` — allowlist source of truth for admin access (see `docs/auth-and-sms.md`)
- `ARVAN_API_KEY`
- `BILLING_WORKER_INTERVAL_MS`
- `ABRCHIN_IMAGE`
- `TRUSTED_PROXY_HOPS` — set to the known reverse-proxy hop count (typically `1`)

## Security headers

Nginx (`ops/nginx/abrchin.conf`) and Next (`next.config.ts`) emit a conservative baseline:

- `Strict-Transport-Security` (nginx / HTTPS edge)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options` / CSP `frame-ancestors 'none'`
- CSP compatible with Next.js App Router (includes `'unsafe-inline'` for hydration)

Forwarded Host/Proto/IP are overwritten at nginx and trusted by the app only when `TRUSTED_PROXY_HOPS > 0`.

مقدار Secret در Shell output، Log، Screenshot یا Admin response چاپ نمی‌شود.
