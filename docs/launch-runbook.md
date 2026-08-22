# Runbook لانچ کنترل‌شده V2 ابرچین

دامنه این Runbook فقط Launch عمومی `PREPAID_TERM` با Fulfillment دستی است. PAYG در Backend حفظ می‌شود اما مسیر عمومی Launch نیست. هیچ مرحله‌ای در این سند بدون تأیید صریح Founder مجوز Deploy، پرداخت واقعی یا Provider mutation نمی‌دهد. Public Sale طبق تصمیم Founder در ۲۰۲۶-۰۸-۱۰ باز می‌ماند.

## مسیرهای Canonical

```text
Discovery:             https://abrchin.ir/
Catalog:               https://abrchin.ir/cloud-servers
Guest configuration:   https://abrchin.ir/cloud-servers/configure/{planId}
Guest quote:           https://abrchin.ir/cloud-servers/quote/{quoteId}
Wallet top-up:         https://abrchin.ir/account/wallet/topup
Customer orders:       https://abrchin.ir/account/orders
Customer services:     https://abrchin.ir/account/services
Admin fulfillment:     https://abrchin.ir/admin/infrastructure/orders
Health:                https://abrchin.ir/api/health
Readiness:             https://abrchin.ir/api/readiness
```

`/ready-servers` فقط Compatibility است و CTA اصلی Launch نیست. Quote/Order قدیمی برای History و Ownership حفظ می‌شوند اما ورودی جدید نمی‌گیرند.

پس از تأیید اول Admin، Fulfillment دستی از endpoint محافظت‌شده
`/api/admin/infrastructure/orders/{id}/fulfill-manually` انجام می‌شود. این
مرحله Delivery نیست. تأیید نهایی تحویل از endpoint مستقل `approve-delivery`
انجام می‌شود و Customer پیش از آن Credential دریافت نمی‌کند.

## Environment و Gateها

Secretها را هرگز در خروجی Shell، Log، Screenshot یا Artifact ثبت نکنید. Source of truth عملیاتی فایل خارج از Git است و باید با `.env.production.example` تطبیق داده شود.

Gateهای لازم در حالت پیش‌فرض:

```text
PUBLIC_SALE_ENABLED=true
PARSPACK_PUBLIC_SALE_ENABLED=true
PARSPACK_MUTATIONS_ENABLED=false
ARVAN_PUBLIC_SALE_ENABLED=true
ARVAN_READY_PUBLIC_SALE_ENABLED=true
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=true
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=true
```

سایر گروه‌های ضروری:

```text
DATABASE_URL SESSION_SECRET CREDENTIAL_ENCRYPTION_KEY
SMS_PROVIDER KAVENEGAR_API_KEY KAVENEGAR_TEMPLATE
EMAIL_PROVIDER EMAIL_FROM SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD
PAYMENT_CALLBACK_BASE_URL PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER
ZIBAL_MERCHANT ZARINPAL_MERCHANT_ID ZARINPAL_SANDBOX
PARSPACK_ENABLED PARSPACK_API_TOKEN PARSPACK_API_BASE_URL
PARSPACK_MANAGEMENT_API_BASE_URL PARSPACK_PRICE_CURRENCY
PARSPACK_PRICE_AMOUNT_UNIT PARSPACK_API_VERSION
ARVAN_ENABLED ARVAN_API_KEY ARVAN_API_BASE_URL ARVAN_API_VERSION
ARVAN_REGION_CODES CATALOG_SYNC_INTERVAL_MS
WORKER_POLL_MS WORKER_LEASE_MS WORKER_STALE_AFTER_MS WORKER_ID
```

واحد پول دیتابیس `IRR` و نوع مبلغ `BigInt` است. Gateway فقط Top-up را Verify/Credit می‌کند. Order purchase فقط از Wallet Ledger Debit می‌شود.

## Preflight بدون عملیات خارجی

1. SHA/branch و dirty worktree را ثبت کنید.
2. `npm ci`، `npm run lint`، `npm run typecheck` و `npm run build` را اجرا کنید.
3. `npm audit --omit=dev --audit-level=low` و `npm run test:secret-scan` را اجرا کنید.
4. تمام تست‌های Phase 0–9 را بدون Skip اجرا و Artifactها را ثبت کنید.
5. `prisma migrate deploy` را فقط روی DB ایزوله/Staging مجاز اجرا کنید؛ Production نیازمند اجازه جداگانه است.
6. قراردادهای نسخه ۳ پرچین، فعال‌سازی پس از تحویل و صف عملیات روی DB ایزوله تست می‌شوند.
7. در تمام Preflightها Sale gateها `true` و Mutation gateها `false` می‌مانند.

## Deploy کنترل‌شده

این بخش فقط پس از تأیید Deploy Founder اجرا می‌شود. Migrationها forward-only هستند؛ `prisma migrate reset` و حذف volume ممنوع است.

```bash
set -Eeuo pipefail
cd /opt/abrchin
git fetch --prune origin
git checkout main
git pull --ff-only origin main
TARGET_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"
export APP_DIR="/opt/abrchin"
export ENV_FILE=".env"
export COMPOSE_FILE="compose.production.yaml"
export ABRCHIN_IMAGE="abrchin:${TARGET_SHA:0:12}"
export DEPLOY_IMAGE_SOURCE="local"
export BACKUP_BEFORE_DEPLOY="1"
./ops/deploy.sh
```

پس از Deploy و با Sale باز:

```bash
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness
```

## Staging purchase اجباری

Staging باید از Gateway/OTP/SMTP واقعی و داده Provider واقعی read-only استفاده کند، اما Launch با Fulfillment دستی است و mutation Provider خاموش می‌ماند.

1. یک Offer واقعی و قابل ردیابی با قیمت/ارز/واحد معتبر Publish کنید.
2. از `/cloud-servers` Config و Quote PREPAID بسازید؛ ۱/۳/۶/۱۲ ماه و Snapshot را بررسی کنید.
3. Login/Claim را اجرا و نبود تغییر Quote را ثبت کنید.
4. Wallet را با Top-up واقعی شارژ و Credit یکتا را بررسی کنید.
5. Order را از Wallet پرداخت کنید؛ Debit/Order/Inventory effect باید یکتا باشد.
6. Approval اول Admin، Fulfillment دستی و Approval دوم را به‌ترتیب اجرا کنید.
7. پیش از Approval دوم Customer نباید Secret ببیند؛ پس از آن Reveal فقط یک‌بار است.
8. Renewal، Upgrade shortfall و Cancel/Refund Ledger را بررسی کنید.
9. هیچ Secret، Raw gateway response یا Credential وارد Artifact نشود.

## پایداری Public Sale

Public Sale از ابتدا باز می‌ماند. Deploy نباید Master یا Source sale gateها را
خاموش کند. Staging purchase، Production smoke و ظرفیت انسانی عملیات پرچین
همچنان پیش‌نیازهای عملیاتی Deploy هستند.

کنترل‌های لازم:

1. Source/Region/Catalog/price freshness و موجودی واقعی را تأیید کنید.
2. On-call رخداد P1 و Owner صف روزانه پرچین را در مرکز عملیات تأیید کنید.
3. Master و provider/source sale gateها را `true` نگه دارید.
4. Provider mutation برای Launch دستی `false` می‌ماند.
5. `web` و `worker` را با همان Image/SHA recreate کنید.
6. Health/Readiness و یک smoke بدون خرید اضافی را ثبت کنید.

روشن‌کردن Provider gate نمی‌تواند master، قرارداد پرچین، Region یا freshness را دور بزند.

## Rollback بدون حذف Database

Rollback فقط با Image قبلی ثبت‌شده و تأیید Incident Owner انجام می‌شود. Sale
باز و Mutation خاموش می‌ماند؛ Database/volume دست‌نخورده است.

```bash
set -Eeuo pipefail
cd /opt/abrchin
export PUBLIC_SALE_ENABLED="true"
export ROLLBACK_IMAGE="REPLACE_WITH_PREVIOUS_IMAGE"
test -n "$ROLLBACK_IMAGE"
export ABRCHIN_IMAGE="$ROLLBACK_IMAGE"
docker compose --env-file .env -f compose.production.yaml \
  up -d --no-deps --force-recreate --wait --wait-timeout 120 \
  web worker catalog-sync
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness
```

## Stop conditions

در هر یک از موارد زیر توقف و Verdict `NO-GO` است:

- تست الزامی Fail/Skip یا High/Critical production dependency؛
- Migration واقعی Staging، Staging purchase یا Production smoke انجام‌نشده؛
- داده حقوقی، قیمت/ارز/واحد Provider یا مسئول عملیات تأییدنشده؛
- نبود Owner و ظرفیت انسانی برای صف کار و رخدادهای P1 پرچین؛
- Draft PR/Review/SHA نامشخص؛
- نبود rollback target یا backup evidence؛
- نبود تأیید صریح Founder برای Deploy.

سبز بودن Build و تست محلی به‌تنهایی مجوز Deploy یا Provider mutation واقعی نیست.
