# AbrChin

وب‌سایت تمام‌صفحه و داشبوردی ابرچین؛ طراحی‌شده بر مبنای نیاز کاربر، نه نام تکنولوژی.

## صفحات

- خانه — پیام فروش و شروع سریع
- قطب‌نما — پیشنهاد زیرساخت در پنج سؤال
- راهکارها — مسیرهای آماده بر اساس نوع نیاز
- سطح همراهی — خام، آماده‌به‌کار و مدیریت‌شده
- درباره ابرچین — داستان برند و نقشه‌ی توسعه‌ی ۲۴ ماهه
- راهنما و ارتباط — سؤال‌های پرتکرار و راه تماس

## اجرا

```bash
npm install
npm run dev
```

سپس `http://localhost:3010` را باز کنید.

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

## استقرار Production

- تست‌ها روی Pull Request و هر Push به `main` خودکار اجرا می‌شوند.
- استقرار فقط با اجرای دستی Workflow با نام `Deploy AbrChin production` شروع می‌شود.
- Image همان Commit با SHA در GHCR ساخته می‌شود و روی سرور جایگزین نسخه‌ی قبلی می‌گردد.
- سرویس فقط روی `127.0.0.1:3010` در دسترس است و Nginx ترافیک عمومی را عبور می‌دهد.
- Healthcheck ناموفق باعث بازگشت خودکار به Image قبلی می‌شود.

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
`https://abrchin.ir/api/health` تنظیم شود.

## هویت بصری

- لوگوی قفل‌شده‌ی ابرچین در `public/assets` نگهداری می‌شود.
- رابط کاربری از فونت Mikhak DS1 با وزن‌های Medium و Black استفاده می‌کند.
- مجوز فونت در `public/assets/fonts/OFL.txt` قرار دارد.
