# Production deployment

> این سند فقط Runbook است. اجرای Deploy، Payment واقعی، Refund بانکی یا
> Provider Mutation نیازمند مجوز صریح Founder است.

## Compose

`compose.production.yaml` شامل:

- PostgreSQL 16 با Volume پایدار
- Next.js Web
- Worker برای Provisioning، Billing Settlement، Dunning و Reconciliation
- Scheduler مستقل Read-only برای Catalog Sync؛ این Process هیچ Provisioning
  یا Provider Mutation اجرا نمی‌کند

## Bootstrap

1. `.env.production.example` را بدون Commit به `.env` کپی و Secretها را وارد
   کنید.
2. SHA تأییدشده `origin/main` و Image را قفل کنید.
3. `docker compose ... config --quiet` را اجرا کنید.
4. فقط `prisma migrate deploy` مجاز است؛ `migrate dev` یا Reset در Production
   ممنوع است.
5. پس از Migration، Web، Worker و `catalog-sync` را با همان Image/SHA بالا
   بیاورید.

## Secret و Environment

- `POSTGRES_PASSWORD`, `DATABASE_URL`
- `SESSION_SECRET`
- `CREDENTIAL_ENCRYPTION_KEY`
- `KAVENEGAR_API_KEY` در صورت OTP واقعی
- `ZIBAL_MERCHANT` یا `ZARINPAL_MERCHANT_ID`
- `PAYMENT_CALLBACK_BASE_URL`
- `ADMIN_MOBILES`
- `ARVAN_API_KEY` و/یا `PARSPACK_API_TOKEN`
- `PARSPACK_PRICE_CURRENCY`, `PARSPACK_PRICE_AMOUNT_UNIT`
- `BILLING_WORKER_INTERVAL_MS`

مقدار Secret در Shell output، Log، Screenshot یا Admin response چاپ نمی‌شود.

## Migration gate

پیش از Deploy:

- Fresh migration روی PostgreSQL ایزوله پاس شود.
- Upgrade از Schema قبلی با داده Wallet/Order/Resource پاس شود.
- Backfill Cadence سرویس فعال Non-retroactive باشد.
- Planهای Cloud جدید Hourly و Serviceهای موجود روی Snapshot قبلی بمانند.
- Migration هیچ Sale/Mutation Gate را باز نکند.
- Rollback کد Database/Volume را حذف نکند.

## Gateها

Launch: Sale باز، Mutation خاموش (Fulfillment دستی Admin):

```text
PARSPACK_PUBLIC_SALE_ENABLED=true
PARSPACK_MUTATIONS_ENABLED=false
ARVAN_PUBLIC_SALE_ENABLED=true
ARVAN_READY_PUBLIC_SALE_ENABLED=true
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=true
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=true
```

Sale و Mutation مستقل هستند. Sale فقط Listing/Estimate/Wallet Top-up/Activation
را مجاز می‌کند. Mutation فقط هنگام Dispatch واقعی و پس از Admin Approval
بررسی می‌شود. Sale باز با Mutation بسته به معنی Fulfillment دستی کنترل‌شده
است، نه Provider Healthy یا Provision خودکار.

## Post-deploy read-only checks

- `/api/health` برای Liveness
- `/api/readiness` برای Database و Worker heartbeat
- `docker compose --env-file .env.production -f compose.production.yaml ps
  catalog-sync` برای Running بودن Scheduler مستقل
- آخرین `ServiceConnectionCheck` در Admin
- Arvan Connection Check با GET احرازشده و بدون Mutation
- Catalog/Rate freshness بدون Auto-publish
- Operations Center با ۱۲ Queue مالی و عملیاتی

این Checkها مجوز Public Sale نیستند.

```bash
curl --fail --silent --show-error https://abrchin.ir/api/health
curl --fail --silent --show-error https://abrchin.ir/api/readiness
curl --fail --silent --show-error https://abrchin.ir/cloud-servers >/dev/null
docker compose --env-file .env.production -f compose.production.yaml \
  ps web worker catalog-sync db
```

## Catalog Sync خواندنی

Image Production فایل `dist/catalog-sync/catalog-sync.js` را دارد. فرمان‌های
زیر داخل `abrchin-web` اجرا می‌شوند و به Worker یا فایل‌های تست وابسته نیستند:

```bash
docker compose --env-file .env.production -f compose.production.yaml \
  exec -T web npm run sync:catalog:parspack

docker compose --env-file .env.production -f compose.production.yaml \
  exec -T web npm run sync:catalog:arvan

# اختیاری: هر دو Provider، مستقل و به ترتیب ثابت
docker compose --env-file .env.production -f compose.production.yaml \
  exec -T web npm run sync:catalog:all
```

هر خط نتیجه JSON فقط فیلدهای امن زیر را دارد:

```text
event, readOnly, ok, provider, apiVersion, status,
startedAt, completedAt, durationMs, catalogVersion,
counts, failureCodes | safeError
```

`counts` شامل Region، Plan، Image، Network، Security، Catalog Item، Priced،
Unavailable، Stale، Invalid Price و Invalid Resource است. Token، Authorization
Header، URL دارای Secret و Response خام چاپ یا ذخیره نمی‌شوند. Status غیر
`SUCCEEDED` Exit Code غیرصفر دارد، اما دادهٔ سالم قبلی حذف نمی‌شود.

سرویس `catalog-sync` همین مسیر را با `CATALOG_SYNC_INTERVAL_MS` اجرا می‌کند.
فرمان‌های دستی بالا برای Sync فوری هستند و به Restart سرویس
`abrchin-worker` وابسته نیستند.

## Founder test

ترتیب Cloud PAYG باید دقیقاً باشد:

```text
Wallet Top-up
→ Estimate
→ Activation Request
→ Admin Approval 1
→ Controlled Provision
→ Provider Confirmation / Billing Start
→ Admin Verification
→ Admin Approval 2
→ Secure Delivery
→ Wallet Settlement
→ Reconciliation
```

Callback شارژ، Wallet Credit، Approval، Provision، Delivery و Settlement باید
در Retry/Concurrency تکراری نشوند. کمبود موجودی فقط Invoice/Outstanding،
Notification و Suspension Review می‌سازد؛ Auto-delete/terminate ممنوع است.

## Backup و Rollback

`ops/backup-postgres.sh` پیش از Migration اجرا و نتیجه Restore آن بررسی شود.
Rollback کد از Image قبلی انجام می‌شود؛ Database و Volume Reset نمی‌شوند.
Migrationهای Forward-only باقی می‌مانند و نسخه قبلی باید جدول‌های جدید را
نادیده بگیرد.
