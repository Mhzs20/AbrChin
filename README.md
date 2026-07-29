# AbrChin

وب‌سایت تمام‌صفحه و داشبوردی ابرچین؛ طراحی‌شده بر مبنای نیاز کاربر، نه نام تکنولوژی.

## صفحات

- خانه — پیام فروش و شروع سریع
- قطب‌نما — گفت‌وگوی تطبیقی، رتبه‌بندی ظرفیت واقعی و سه پیشنهاد زمان‌دار
- راهکارها — نمونه‌چینش‌های آماده بر اساس نوع نیاز
- سطح همراهی — سرور خام یا همراه ابرچین با دامنه‌ی مسئولیت روشن
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

- تست‌ها روی Pull Request و هر Push به `main` خودکار اجرا می‌شوند.
- استقرار فقط با اجرای دستی Workflow با نام `Deploy AbrChin production` شروع می‌شود.
- Image همان Commit با SHA در GHCR ساخته می‌شود و روی سرور جایگزین نسخه‌ی قبلی می‌گردد.
- Compose شامل `web`، `worker` و `db` است؛ Postgres پورت عمومی ندارد.
- سرویس وب فقط روی `127.0.0.1:3010` در دسترس است و Nginx ترافیک عمومی را عبور می‌دهد.
- قبل از start، `prisma migrate deploy` در entrypoint اجرا می‌شود.
- برای bootstrap: `./ops/bootstrap-production.sh`
- برای backup: `./ops/backup-postgres.sh`
- نمونه Env: `.env.production.example`

فایل‌های عملیاتی:

- `Dockerfile`
- `compose.production.yaml`
- `ops/deploy.sh`
- `ops/nginx/abrchin.conf`

Secrets لازم در GitHub Environment با نام `production`:

- `PROD_SSH_HOST`
- `PROD_SSH_PORT`
- `PROD_SSH_USER`
- `PROD_SSH_PRIVATE_KEY`
- `PROD_SSH_KNOWN_HOSTS`

متغیر اختیاری `PROD_HEALTHCHECK_URL` می‌تواند روی
`https://abrchin.ir/api/readiness` تنظیم شود. `/api/health` فقط Liveness کانتینر
وب است و برای Restart داخلی استفاده می‌شود.

## هویت بصری

- لوگوی قفل‌شده‌ی ابرچین در `public/assets` نگهداری می‌شود.
- رابط کاربری از فونت Mikhak DS1 با وزن‌های Medium و Black استفاده می‌کند.
- «پرچین پایه» کنترل تحویل، نمایش یک‌بارمصرف دسترسی و پیگیری چرخه‌ی سفارش است؛
  پایش پیوسته، بکاپ خودکار و نگه‌داری سیستم‌عامل را بدون ثبت جداگانه شامل نمی‌شود.
- پیشنهادهای گفت‌وگو با قیمت سرور ساخته می‌شوند، ۱۰ دقیقه اعتبار دارند و مبلغ
  پیش از برداشت کیف پول با Catalog و Availability زنده دوباره تطبیق داده می‌شود.
- قیمت فروش و تمدید از `price_monthly` کاتالوگ Provider و Markup سراسری Admin
  با محاسبه BigInt/Basis Points ساخته می‌شود؛ ورود دستی قیمت Source of Truth نیست.
- تمدید خودکار وجود ندارد؛ هر تمدید Quote ده‌دقیقه‌ای، تأیید صریح و Snapshot
  مالی مستقل دارد.
- مجوز فونت در `public/assets/fonts/OFL.txt` قرار دارد.
