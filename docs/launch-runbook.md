# Runbook لانچ کنترل‌شده ابرچین

این Runbook برای سرور Pre-launch، Repository در `/opt/abrchin` و Compose واقعی
`compose.production.yaml` نوشته شده است. هیچ Sale یا Mutation Gate در Migration
فعال نمی‌شود. هر Flag فقط پس از تست مرحلهٔ مربوط تغییر می‌کند.

## مسیرها

```text
Ready catalog:           https://abrchin.ir/ready-servers
Arvan cloud catalog:     https://abrchin.ir/cloud-servers
Wallet top-up:           https://abrchin.ir/account/wallet/topup
Customer PAYG requests:  https://abrchin.ir/account/orders
Customer services:       https://abrchin.ir/account/services
Admin providers:         https://abrchin.ir/admin/infrastructure/providers
Admin catalog/inventory: https://abrchin.ir/admin/infrastructure/plans
Admin orders/delivery:   https://abrchin.ir/admin/infrastructure/orders
Admin payment gateway:   https://abrchin.ir/admin/payment-gateways
Health:                  https://abrchin.ir/api/health
Readiness:               https://abrchin.ir/api/readiness
```

نمایش یک‌بارمصرف Credential از جزئیات سرویس مشتری و API مالکیت‌دار
`/api/account/instances/{id}/credentials/reveal` انجام می‌شود. Fulfillment دستی
پس از تأیید اول Admin از دکمهٔ همان سفارش در صفحه Admin Orders و API محافظت‌شده
`/api/admin/infrastructure/orders/{id}/fulfill-manually` ثبت می‌شود. این کار
سفارش را فقط به «منتظر تأیید تحویل Admin» می‌رساند؛ مسیرهای
`approve-delivery` و `hold-delivery` گیت دوم مستقل هستند.

## Environment لازم

مقدار Secretها را در خروجی Shell چاپ نکنید. نام‌های لازم را با
`.env.production.example` تطبیق دهید:

```text
ABRCHIN_IMAGE
POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL
SESSION_SECRET CREDENTIAL_ENCRYPTION_KEY TRUSTED_PROXY_HOPS
SMS_PROVIDER KAVENEGAR_API_KEY KAVENEGAR_TEMPLATE KAVENEGAR_ALERT_TEMPLATE
OTP_TTL_SECONDS SESSION_TTL_DAYS ADMIN_MOBILES
PAYMENT_CALLBACK_BASE_URL PAYMENT_BOOTSTRAP_DEFAULT_PROVIDER
ZIBAL_MERCHANT ZARINPAL_MERCHANT_ID ZARINPAL_SANDBOX
PARSPACK_ENABLED PARSPACK_API_TOKEN PARSPACK_API_BASE_URL
PARSPACK_MANAGEMENT_API_BASE_URL PARSPACK_PRICE_CURRENCY
PARSPACK_PRICE_AMOUNT_UNIT PARSPACK_API_VERSION
PARSPACK_PUBLIC_SALE_ENABLED PARSPACK_MUTATIONS_ENABLED
ARVAN_ENABLED ARVAN_API_KEY ARVAN_API_BASE_URL ARVAN_API_VERSION
ARVAN_REGION_CODES ARVAN_PUBLIC_SALE_ENABLED
ARVAN_READY_PUBLIC_SALE_ENABLED ARVAN_CLOUD_PUBLIC_SALE_ENABLED
ARVAN_MUTATIONS_ENABLED MANUAL_READY_PUBLIC_SALE_ENABLED
CATALOG_SYNC_INTERVAL_MS BILLING_WORKER_INTERVAL_MS
WORKER_POLL_MS WORKER_LEASE_MS
WORKER_STALE_AFTER_MS WORKER_ID
```

واحد پول Canonical دیتابیس `IRR` و نوع مبلغ `BigInt` است. Callback عمومی
پرداخت باید `PAYMENT_CALLBACK_BASE_URL=https://abrchin.ir` باشد؛ مسیر دقیق
Zibal یا Zarinpal را Adapter موجود می‌سازد. در جریان Cloud PAYG، Callback فقط
Wallet Top-up را Verify و Credit می‌کند و هیچ Activation یا Provision اجرا
نمی‌کند.

برای تست فروش واقعی Founder این مقادیر را در `.env` سرور بگذارید
(Sale باز، Mutation خاموش):

```text
PARSPACK_PUBLIC_SALE_ENABLED=true
PARSPACK_MUTATIONS_ENABLED=false
ARVAN_PUBLIC_SALE_ENABLED=true
ARVAN_READY_PUBLIC_SALE_ENABLED=true
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=true
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=true
```

## Deploy با Termius

Canonical deploy uses `ops/deploy.sh` with `.env.production`.
This does not delete the DB volume and never runs migrate reset.

```bash
set -Eeuo pipefail
cd /opt/abrchin

git fetch --prune origin
git checkout main
git pull --ff-only origin main

TARGET_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain)"

export APP_DIR="/opt/abrchin"
export ENV_FILE=".env.production"
export COMPOSE_FILE="compose.production.yaml"
export ABRCHIN_IMAGE="abrchin:${TARGET_SHA:0:12}"
export DEPLOY_IMAGE_SOURCE="local"
export BACKUP_BEFORE_DEPLOY="1"

chmod +x ops/deploy.sh ops/backup-postgres.sh
./ops/deploy.sh
```

See `docs/production-deployment.md` for registry mode, migration contract,
accounting dry-run backfill, and Profit Curve activation notes.

### Rollback کد بدون حذف Database

Migrationهای این Release Forward-only و Additive هستند؛ در Rollback کد،
Database و Volume دست‌نخورده می‌مانند. هرگز `docker compose down -v` یا
`prisma migrate reset` اجرا نکنید.

```bash
set -Eeuo pipefail
cd /opt/abrchin
ROLLBACK_IMAGE="REPLACE_WITH_PREVIOUS_IMAGE"
test -n "$ROLLBACK_IMAGE"
sed -i "s|^ABRCHIN_IMAGE=.*$|ABRCHIN_IMAGE=${ROLLBACK_IMAGE}|" .env.production
export ABRCHIN_IMAGE="$ROLLBACK_IMAGE"
docker compose --env-file .env.production -f compose.production.yaml \
  up -d --no-deps --force-recreate --wait --wait-timeout 120 \
  web worker catalog-sync
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness
```

## فعال‌سازی فروش Launch

1. Login OTP، Gateway Production، Health و Readiness را بررسی کنید.
2. در `.env` سرور Flagهای Sale بالا را `true` و Mutationها را `false` بگذارید،
   سپس `web` و `worker` را Recreate کنید.
3. Admin → زیرساخت → مناطق فروش: هر Region لازم باید «نمایش» (saleEnabled) باشد.
   بعد از Deploy، مسیر چینش/قطب‌نما خودش Regionهای AV/PP را برای فروش باز می‌کند.
4. Admin → تنظیمات: «فروش آروان Cloud» و «فروش پارس‌پک» باید «باز» باشند.
5. Mutation را باز نکنید؛ Fulfillment دستی Admin بعد از دو Gate تأیید است.

هر تغییر Env نیازمند Recreate شدن `web` و `worker` با همان Image/SHA است.

## قاعدهٔ توقف Founder

تا وقتی Founder صریحاً Deploy و تست واقعی را مجاز نکرده است، این Runbook فقط
برای Preflight است: هیچ Gate باز، Migration Production، پرداخت واقعی، Provision
Provider، ارسال Credential یا عملیات بازگشت‌ناپذیر انجام نمی‌شود. نتیجهٔ تست
واقعی باید در Checklist فاز ۱ ثبت شود؛ سبز بودن Build یا اتصال Read-only به‌معنای
اجازهٔ فروش عمومی نیست.

## تست Founder

### ۱. Manual Ready

در `/admin/infrastructure/plans` یک `MANUAL_ADMIN` با قیمت واقعی، سیستم‌عامل،
منابع و تعداد حداقل یک بسازید و منتشر کنید. در `/ready-servers` Quote بگیرید،
با OTP وارد شوید، کسری دقیق Wallet را از درگاه واقعی شارژ و سفارش را پرداخت
کنید. سپس ترتیب زیر الزامی است:

1. ابتدا Order را در `Waiting Admin Provision Approval` بررسی کنید و مطمئن شوید
   هیچ Resource یا Job جدیدی پیش از تأیید اول ساخته نشده است.
2. هزینه/موجودی Source را بررسی و فقط یک‌بار `تأیید و ساخت/تخصیص` را ثبت کنید.
3. در `/admin/infrastructure/orders` Resource ID، IPv4، Region، Plan، Image،
   Username و Password موقت یکتا را با Fulfillment دستی محافظت‌شده ثبت کنید.
4. Order باید به `Waiting Admin Delivery Approval` برسد؛ در این نقطه Customer
   نباید IP یا Credential ببیند. Credential فقط با دکمهٔ صریح بازبینی در جزئیات
   Instance و برای Admin قابل مشاهده است.
5. Resource، Health و تطبیق Snapshot را بررسی کنید؛ سپس فقط یک‌بار
   `تأیید نهایی تحویل` را ثبت کنید. در صورت اختلاف، `نگه‌داشتن تحویل` را بزنید.
6. اکنون مالک در `/account/orders/{id}` اطلاعات غیرحساس سرویس را می‌بیند و
   Credential را فقط یک‌بار Reveal می‌کند. مقدار موجودی باید دقیقاً یک واحد کم
   شده باشد و Audit هر دو تأیید را داشته باشد.

### ۲. ParsPack Ready

پس از Sync موفق و تنظیم Markup، یک Plan ثابت ParsPack را منتشر کنید. Sale و
Mutation ParsPack را فقط برای همین تست باز کنید. Quote، OTP، Wallet و Order را
انجام دهید؛ Order و Job باید Provider/Region/Size/Image قفل‌شدهٔ ParsPack را
حفظ کنند و بدون fallback تا تحویل ادامه دهند.

### ۳. Arvan Ready

از Catalog آروان یک Plan با Product Kind سرور فوری منتشر کنید. Gateهای Master،
Ready و Mutation آروان را باز کنید. خرید باید از `/ready-servers` انجام و همان
Flavor/Region/Image آروان Provision شود؛ هیچ ParsPack fallback مجاز نیست.

### ۴. Cloud PAYG

در `/cloud-servers` یک Region، Flavor و Image معتبر انتخاب کنید:

1. Estimate ساعتی و ۲۴ساعته، Cadence و حداقل اعتبار را بررسی کنید.
2. Wallet را شارژ کنید. Callback فقط یک Credit می‌سازد و با Quote منقضی رد
   نمی‌شود.
3. Activation Request را ثبت کنید. پیش از Admin Approval هیچ Job/Resource و
   هیچ Debit خرید وجود ندارد.
4. Approval اول، Provision کنترل‌شده و Confirmation Provider را به‌ترتیب ثبت
   کنید. `ResourceVersion.effectiveFrom` باید زمان Confirmation باشد.
5. پیش از Approval دوم Customer نباید IP/Credential ببیند.
6. Approval دوم و Reveal یک‌بارمصرف را بررسی کنید.
7. Billing Worker Period بسته را Settlement کند؛ اجرای دوباره Debit دوم نسازد.
8. تغییر Availability پیش از Activation به Estimate تازه منجر شود، نه
   جایگزینی Provider/Plan. شارژ موفق Wallet حفظ می‌شود.

### ۵. Low Balance و Dunning

با Wallet کنترل‌شده، Invoice ناقص بسازید. مبلغ کامل مصرف باید در Invoice،
مبلغ پرداخت‌شده در Ledger و باقی‌مانده در Outstanding ثبت شود. Low Balance و
Grace فقط Notification/Suspension Review بسازند. Suspend نیازمند Action Admin
است و Delete/Terminate خودکار مطلقاً نباید اجرا شود.
