# AbrChin

وب‌سایت تمام‌صفحه و داشبوردی ابرچین؛ طراحی‌شده بر مبنای نیاز کاربر، نه نام تکنولوژی.

## صفحات

- خانه — پیام فروش و شروع سریع
- قطب‌نما — گفت‌وگوی تطبیقی، رتبه‌بندی ظرفیت واقعی و سه پیشنهاد زمان‌دار
- راهکارها — نمونه‌چینش‌های آماده بر اساس نوع نیاز
- پرچین — قرارداد عملیاتی شروع، استوار یا کهکشان با خروجی و SLA روشن
- درباره ابرچین — داستان برند و نقشه‌ی توسعه‌ی ۲۴ ماهه
- راهنما و ارتباط — سؤال‌های پرتکرار و راه تماس
- وضعیت سرویس — Readiness زنده‌ی وب، دیتابیس و Worker تأمین

## اجرا

```bash
cp .env.example .env
# DATABASE_URL، SESSION_SECRET و CREDENTIAL_ENCRYPTION_KEY را تنظیم کنید
npx prisma migrate deploy
npm install
npm run dev
```

سپس `http://localhost:3010` را باز کنید.

برای OTP در Development مقدار `SMS_PROVIDER=console` را نگه دارید و کد را در لاگ سرور ببینید.
برای شارژ کیف پول در Development، `ZIBAL_MERCHANT=zibal` (حساب تست رسمی زیبال) را تنظیم کنید یا از پنل ادمین درگاه آزمایشی را پیش‌فرض کنید.

مستندات:
- `docs/launch-golden-paths.md`
- `docs/phase-1-product-contract.md`
- `docs/auth-and-sms.md`
- `docs/wallet-architecture.md`
- `docs/payment-flow.md`
- `docs/production-deployment.md`
- `docs/manual-acceptance-test.md`

## نسخه نهایی

```bash
npm run build
npm start
```

نسخه‌ی توسعه و Production هر دو به‌صورت پیش‌فرض روی پورت `3010` اجرا می‌شوند.

برای بررسی همه‌ی مسیرها و فایل‌های حیاتی بعد از Build:

```bash
npm run test:smoke
```

تست کامل:

```bash
npm run test:all
```

## استقرار Production

- تست و انتشار Image به‌صورت دستی و کنترل‌شده از روی SHA تأییدشده انجام می‌شود؛
  این Repository به GitHub Actions یا Deploy خودکار متکی نیست.
- Canonical deploy: `ops/deploy.sh` با `.env` و
  `compose.production.yaml` (جزئیات: `docs/production-deployment.md`).
- Default: `DEPLOY_IMAGE_SOURCE=local` — Image immutable روی سرور Build می‌شود؛
  `docker compose pull` اجرا نمی‌شود.
- Compose شامل `db`، `web`، `worker` و `catalog-sync` است؛ Postgres پورت عمومی
  ندارد؛ وب فقط روی `127.0.0.1:3010` است.
- Migration gate صریح در deploy قبل از Start سرویس‌های App اجرا می‌شود.
  Web entrypoint به‌صورت پیش‌فرض Schema را روی Restart عادی mutate نمی‌کند
  (`ABRCHIN_RUN_MIGRATE_ON_START=false`).
- Accounting backfill خودکار نیست؛ پس از Health با
  `npm run accounting:backfill -- --dry-run` و سپس real run.
- برای bootstrap: `./ops/bootstrap-production.sh`
- برای backup: `./ops/backup-postgres.sh`
- نمونه Env: `.env.production.example`

فایل‌های عملیاتی:

- `Dockerfile`
- `compose.production.yaml`
- `ops/deploy.sh`
- `ops/backup-postgres.sh`
- `ops/nginx/abrchin.conf`

Runbook فعال‌سازی مرحله‌ای و تست Founder در `docs/launch-runbook.md` است.
`/api/health` فقط Liveness و `/api/readiness` Readiness وب، دیتابیس و Worker است.

## هویت بصری

- لوگوی قفل‌شده‌ی ابرچین در `public/assets` نگهداری می‌شود.
- رابط کاربری از فونت Mikhak DS1 با وزن‌های Medium و Black استفاده می‌کند.
- پرچین یک قرارداد عملیاتی نسخه‌دار است: شروع برای سلامت پایه، استوار برای
  پایش/بکاپ/Patch، و کهکشان برای عملیات Production و مدیریت رخداد.
- پیش‌فاکتور خرید سرور دقیقاً ۶۰ دقیقه اعتبار دارد و مبلغ Customer در این بازه
  تغییر نمی‌کند؛ سفارش‌های Launch با Fulfillment دستی Admin ساخته و تحویل می‌شوند.
- قیمت فروش و تمدید از `price_monthly` کاتالوگ Provider و Markup سراسری Admin
  با محاسبه BigInt/Basis Points ساخته می‌شود؛ ورود دستی قیمت Source of Truth نیست.
- `/cloud-servers` فقط SKUهای منتشرشده و قابل‌خرید Admin از منابع آروان و
  پارس‌پک را نمایش می‌دهد؛ نام Provider در تجربه مشتری افشا نمی‌شود.
- تمدید خودکار وجود ندارد؛ هر تمدید Quote قفل‌شده، تأیید صریح و Snapshot
  مالی مستقل دارد.
- مجوز فونت در `public/assets/fonts/OFL.txt` قرار دارد.
