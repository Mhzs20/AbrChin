# اتصال سرور ابری پارس‌پک

این سند قرارداد فعلی Adapter پارس‌پک در ابرچین را ثبت می‌کند. هیچ توکن، پاسخ واقعی
مشتری یا اطلاعات سرویس نباید در این فایل یا لاگ‌های Git ذخیره شود.

## قراردادهای پیاده‌سازی‌شده

| عملیات | Endpoint | وضعیت |
| --- | --- | --- |
| بررسی اتصال | `GET /cserver/api/public/v1/regions?page=1&per_page=1` | پیاده‌سازی‌شده |
| دریافت منطقه‌ها | `GET /cserver/api/public/v1/regions` | پیاده‌سازی‌شده |
| دریافت پلن‌ها و قیمت Provider | `GET /cserver/api/public/v1/sizes` | پیاده‌سازی‌شده |
| دریافت Imageها | `GET /cserver/api/public/v1/images` | پیاده‌سازی‌شده |
| یافتن VM با نام | `GET /cserver/api/public/v1/vms?name=...` | پیاده‌سازی‌شده |
| دریافت VM | `GET /cserver/api/public/v1/vms/{id}` | پیاده‌سازی‌شده |
| ساخت VM | `POST /cserver/api/v1/vms` | پیاده‌سازی‌شده |

تمام درخواست‌ها هدرهای `Accept: application/json`،
`Accept-Language: en` و `Authorization: Bearer ...` دارند. پاسخ‌های رسمی
envelopeهایی مانند `vm`، `vms`، `regions`، `sizes` و `images` دارند و Adapter
آن‌ها را به قرارداد داخلی ابرچین تبدیل می‌کند.

## تنظیمات محیط

```dotenv
INFRASTRUCTURE_PROVIDER_MODE=parspack
PARSPACK_ENABLED=true
PARSPACK_API_BASE_URL=https://my.parspack.com/cserver/api/v1
PARSPACK_PUBLIC_API_BASE_URL=https://my.parspack.com/cserver/api/public/v1
PARSPACK_API_TOKEN=
PARSPACK_TIMEOUT_MS=15000
```

توکن فقط باید در Secret Store محیط اجرا قرار بگیرد و نباید در Git، پنل ادمین،
API پاسخ‌گویی یا لاگ‌ها نمایش داده شود.

## تست اتصال بدون ساخت سرور

پس از قراردادن توکن در محیط محلی یا Staging:

```bash
npm run integration:parspack
```

این Probe فقط اتصال و کاتالوگ را می‌خواند، VM ایجاد یا حذف نمی‌کند و توکن را
چاپ نمی‌کند.

## معیار فعال‌کردن قیمت روز و خرید

وجود توکن به‌تنهایی برای فعال‌شدن CTA خرید کافی نیست. پیش از Production باید
این موارد روی حساب همکاری واقعی تأیید شوند:

1. `sizes` قیمت معتبر، واحد پول مشخص و `available` قابل اتکا برگرداند.
2. Region انتخابی در هر دو فهرست `regions[].sizes` و `sizes[].regions` موجود باشد.
3. یک ساخت VM در حساب Staging پاسخ دارای `vm.id` بدهد.
4. خواندن همان VM با ID و یافتن آن با نام هر دو موفق باشند.
5. خطای موجودی ناکافی با پاسخ واقعی ثبت و به
   `provider_insufficient_balance` نگاشت شود.
6. زمان ساخت، حالت‌های status و رسیدن IP در تست پذیرش اندازه‌گیری شوند.
7. واحد و دوره‌ی `price_hourly` و `price_monthly` با صورتحساب واقعی تطبیق داده شود.

تا پایان این پذیرش، ابرچین می‌تواند کاتالوگ را بخواند و مسیر Provisioning را
آماده نگه دارد، اما نباید قیمت نهایی یا «تحویل فوری قطعی» نشان دهد.
