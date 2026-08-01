# Runbook لانچ کنترل‌شده ابرچین

این Runbook برای سرور Pre-launch، Repository در `/opt/abrchin` و Compose واقعی
`compose.production.yaml` نوشته شده است. هیچ Sale یا Mutation Gate در Migration
فعال نمی‌شود. هر Flag فقط پس از تست مرحلهٔ مربوط تغییر می‌کند.

## مسیرها

```text
Ready catalog:           https://abrchin.ir/ready-servers
Arvan cloud catalog:     https://abrchin.ir/cloud-servers
Wallet top-up:           https://abrchin.ir/account/wallet/topup
Customer orders:         https://abrchin.ir/account/order
Customer services:       https://abrchin.ir/account/services
Admin providers:         https://abrchin.ir/admin/infrastructure/providers
Admin catalog/inventory: https://abrchin.ir/admin/infrastructure/plans
Admin orders/delivery:   https://abrchin.ir/admin/infrastructure/orders
Admin payment gateway:   https://abrchin.ir/admin/payment-gateways
Health:                  https://abrchin.ir/api/health
Readiness:               https://abrchin.ir/api/readiness
```

نمایش یک‌بارمصرف Credential از جزئیات سرویس مشتری و API مالکیت‌دار
`/api/account/instances/{id}/credentials/reveal` انجام می‌شود. تحویل دستی از
دکمهٔ همان سفارش در صفحه Admin Orders و API محافظت‌شده
`/api/admin/infrastructure/orders/{id}/manual-delivery` انجام می‌شود.

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
CATALOG_SYNC_INTERVAL_MS WORKER_POLL_MS WORKER_LEASE_MS
WORKER_STALE_AFTER_MS WORKER_ID
```

واحد پول Canonical دیتابیس `IRR` و نوع مبلغ `BigInt` است. Callback عمومی
پرداخت باید `PAYMENT_CALLBACK_BASE_URL=https://abrchin.ir` باشد؛ مسیر دقیق
Zibal یا Zarinpal را Adapter موجود می‌سازد.

پیش از تست Founder این مقادیر خاموش بمانند:

```text
PARSPACK_PUBLIC_SALE_ENABLED=false
PARSPACK_MUTATIONS_ENABLED=false
ARVAN_PUBLIC_SALE_ENABLED=false
ARVAN_READY_PUBLIC_SALE_ENABLED=false
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=false
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=false
```

## Deploy با Termius

`FINAL_SHA` را دقیقاً برابر SHA تأییدشدهٔ `origin/main` قرار دهید. این دستورات
Volume دیتابیس را حذف نمی‌کنند و از Reset استفاده نمی‌کنند.

```bash
set -Eeuo pipefail
cd /opt/abrchin

FINAL_SHA="REPLACE_WITH_APPROVED_MAIN_SHA"
git fetch origin
test "$(git rev-parse origin/main)" = "$FINAL_SHA"
test -z "$(git status --porcelain)"

PREVIOUS_IMAGE="$(docker inspect --format='{{.Config.Image}}' abrchin-web 2>/dev/null || true)"
printf 'previous_image_recorded=%s\n' "${PREVIOUS_IMAGE:+true}"

git switch main
git merge --ff-only "$FINAL_SHA"
test "$(git rev-parse HEAD)" = "$FINAL_SHA"

SHORT_SHA="$(git rev-parse --short=7 HEAD)"
NEW_IMAGE="abrchin:${SHORT_SHA}"
docker build --pull -t "$NEW_IMAGE" -f Dockerfile .

if grep -q '^ABRCHIN_IMAGE=' .env; then
  sed -i "s|^ABRCHIN_IMAGE=.*$|ABRCHIN_IMAGE=${NEW_IMAGE}|" .env
else
  printf '\nABRCHIN_IMAGE=%s\n' "$NEW_IMAGE" >> .env
fi
chmod 600 .env

docker compose --env-file .env -f compose.production.yaml config --quiet
docker compose --env-file .env -f compose.production.yaml up -d db
docker compose --env-file .env -f compose.production.yaml run --rm --no-deps web \
  node ./node_modules/prisma/build/index.js migrate deploy
docker compose --env-file .env -f compose.production.yaml up -d \
  --no-deps --force-recreate web worker

for attempt in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3010/api/health >/dev/null && \
  curl -fsS http://127.0.0.1:3010/api/readiness >/dev/null && break
  test "$attempt" -lt 30
  sleep 2
done

docker compose --env-file .env -f compose.production.yaml ps
docker inspect --format '{{.Name}} image={{.Config.Image}} started={{.State.StartedAt}}' \
  abrchin-web abrchin-worker
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness
docker compose --env-file .env -f compose.production.yaml logs \
  --since=10m --tail=200 web worker
```

### Rollback کد بدون حذف Database

Migration این نسخه Forward-only و Additive است؛ در Rollback کد، Database و
Volume دست‌نخورده می‌مانند. مقدار ثبت‌شدهٔ `PREVIOUS_IMAGE` را استفاده کنید:

```bash
set -Eeuo pipefail
cd /opt/abrchin
ROLLBACK_IMAGE="REPLACE_WITH_PREVIOUS_IMAGE"
test -n "$ROLLBACK_IMAGE"
sed -i "s|^ABRCHIN_IMAGE=.*$|ABRCHIN_IMAGE=${ROLLBACK_IMAGE}|" .env
docker compose --env-file .env -f compose.production.yaml up -d \
  --no-deps --force-recreate web worker
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:3010/api/readiness
```

## فعال‌سازی مرحله‌ای

1. با همه Sale/Mutation Gateها خاموش، Login OTP، Gateway Production، Health و
   Readiness را بررسی و از Admin قیمت پرچین، Tax مصوب و Markupها را تأیید کنید.
2. Manual: SKU واقعی را در Admin Catalog بسازید، قیمت/تعداد را ثبت کنید، سپس
   فقط `MANUAL_READY_PUBLIC_SALE_ENABLED=true` را اعمال و Web/Worker را Recreate
   کنید.
3. ParsPack: ابتدا فقط `PARSPACK_ENABLED=true` و Contract پول را تنظیم کنید؛
   Sync و Revalidation Read-only را در Admin بررسی کنید. سپس با تأیید جداگانه
   `PARSPACK_MUTATIONS_ENABLED=true` و بعد
   `PARSPACK_PUBLIC_SALE_ENABLED=true` را فعال کنید.
4. Arvan: ابتدا فقط `ARVAN_ENABLED=true`، Regionها و Sync Read-only را بررسی
   کنید. پس از تأیید Lifecycle، `ARVAN_MUTATIONS_ENABLED=true` و Master Sale را
   فعال کنید؛ `ARVAN_READY_PUBLIC_SALE_ENABLED` و
   `ARVAN_CLOUD_PUBLIC_SALE_ENABLED` را جداگانه باز کنید.

هر تغییر Env نیازمند Recreate شدن `web` و `worker` با همان Image/SHA است.

## تست Founder

### ۱. Manual Ready

در `/admin/infrastructure/plans` یک `MANUAL_ADMIN` با قیمت واقعی، سیستم‌عامل،
منابع و تعداد حداقل یک بسازید و منتشر کنید. در `/ready-servers` Quote بگیرید،
با OTP وارد شوید، کسری دقیق Wallet را از درگاه واقعی شارژ و سفارش را پرداخت
کنید. در `/admin/infrastructure/orders` Resource ID، IPv4، Username و Password
موقت یکتا را ثبت کنید. مالک در `/account/services` باید IP را ببیند و Credential
را فقط یک‌بار Reveal کند. مقدار موجودی باید یک واحد کم شده باشد.

### ۲. ParsPack Ready

پس از Sync موفق و تنظیم Markup، یک Plan ثابت ParsPack را منتشر کنید. Sale و
Mutation ParsPack را فقط برای همین تست باز کنید. Quote، OTP، Wallet و Order را
انجام دهید؛ Order و Job باید Provider/Region/Size/Image قفل‌شدهٔ ParsPack را
حفظ کنند و بدون fallback تا تحویل ادامه دهند.

### ۳. Arvan Ready

از Catalog آروان یک Plan با Product Kind سرور فوری منتشر کنید. Gateهای Master،
Ready و Mutation آروان را باز کنید. خرید باید از `/ready-servers` انجام و همان
Flavor/Region/Image آروان Provision شود؛ هیچ ParsPack fallback مجاز نیست.

### ۴. Arvan Custom Cloud

در `/cloud-servers` یک Region، Flavor و Image معتبر آروان انتخاب کنید. Quote،
OTP، شارژ کسری و پرداخت را انجام دهید. Snapshot و Payload Worker باید دقیقاً
همان Network/Security/Flavor/Image قفل‌شده را استفاده کند. تغییر Availability
باید به Quote تازه منجر شود، نه جایگزینی Provider یا Plan.
