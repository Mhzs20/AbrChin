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

عملیات Start، Stop، Restart، Reset و Delete تا وقتی مسیر، payload، پاسخ و رفتار
idempotency آن‌ها با حساب واقعی پذیرش نشده، در Adapter و رابط مشتری فعال
نمی‌شوند. دکمه‌ای که فقط ظاهراً کار کند یا از endpoint حدسی استفاده کند مجاز
نیست.

تمام درخواست‌ها هدرهای `Accept: application/json`،
`Accept-Language: en` و `Authorization: Bearer ...` دارند. پاسخ‌های رسمی
envelopeهایی مانند `vm`، `vms`، `regions`، `sizes` و `images` دارند و Adapter
آن‌ها را به قرارداد داخلی ابرچین تبدیل می‌کند.

## قرارداد قیمت و واحد پول

Source of Truth فیلدهای قیمت، OpenAPI رسمی
`https://docs.parspack.com/reference/api/cloud-server/` و پاسخ همان endpoint
`GET /cserver/api/public/v1/sizes` است. پاسخ رسمی فیلدهای
`price_hourly` و `price_monthly` را نشان می‌دهد، اما نسخه `1.0.0` OpenAPI برای
این دو فیلد Currency، Amount Unit و Tax semantics تعریف نکرده است. بنابراین
ابرچین هیچ‌وقت از روی مقدار عددی حدس نمی‌زند که واحد ریال یا تومان است.

دو متغیر زیر فقط پس از دریافت قرارداد مکتوب Provider یا تطبیق رسمی صورتحساب
تنظیم می‌شوند:

```dotenv
PARSPACK_PRICE_CURRENCY=IRR
PARSPACK_PRICE_AMOUNT_UNIT=TOMAN # یا RIAL، فقط مطابق قرارداد تأییدشده
```

اگر هر دو مقدار معتبر نباشند، Sync قیمت خام را Persist می‌کند اما
`currencyCode` و `amountUnit` را خالی نگه می‌دارد، `pricedItemCount` صفر است و
هیچ Plan یا Quote جدیدی قابل فروش نیست. Tax به‌طور ضمنی اضافه یا حذف نمی‌شود.

مبالغ Provider با Scale ثابت شش رقم اعشار به `BigInt` تبدیل می‌شوند؛ بنابراین
مقادیر اعشاری مثل `price_hourly: 0.42` نیز بدون Float ذخیره می‌شوند.

## تنظیمات محیط

```dotenv
INFRASTRUCTURE_PROVIDER_MODE=parspack
PARSPACK_ENABLED=true
PARSPACK_API_BASE_URL=https://my.parspack.com/cserver/api/public/v1
PARSPACK_MANAGEMENT_API_BASE_URL=https://my.parspack.com/cserver/api/v1
PARSPACK_API_TOKEN=
PARSPACK_TIMEOUT_MS=15000
PARSPACK_PRICE_CURRENCY=
PARSPACK_PRICE_AMOUNT_UNIT=
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

## Persist و Availability

دکمه Sync ادمین Region/Size/Image را فقط نمی‌شمارد. هر ترکیب قطعی
`provider + regionCode + sizeCode` در `ProviderCatalogItem` Upsert می‌شود و
منابع، سازگاری Image، Availability، قیمت ساعتی/ماهانه، Currency/Unit،
`lastSyncedAt` و `rawUpdatedAt` را نگه می‌دارد. Sync idempotent است.

قبل از هر Sync، رکوردهای قبلی حذف نمی‌شوند. Size حذف‌شده یا ناموجود
`available=false` و `unavailableAt` می‌گیرد، از Plan/Quote جدید کنار گذاشته
می‌شود و Snapshotهای Quote، Order و Renewal قبلی بدون تغییر می‌مانند. Region
نامشخص با `__unscoped__` Persist ولی غیرقابل فروش می‌شود؛ اتصال حدسی به Region
دیگر ممنوع است.

Planهای قدیمی فقط با تطبیق دقیق Provider/Region/Size و Image سازگار Mapping
می‌شوند. Plan بدون تطبیق غیرفعال و در Admin با وضعیت `UNMAPPED` دیده می‌شود.

در هر Sync، برای هر ترکیب قابل فروش Region×Size یک Plan داخلی با پیشوند
`READY_PARSPACK_` به‌صورت idempotent ساخته یا به‌روز می‌شود. Size مشترک میان
چند Region برای هر Region یک انتخاب مستقل دارد. Image از فهرست Linux
Cloud-init کنترل‌شده انتخاب می‌شود؛ Windows، MikroTik و Control Panelها در این
مسیر فروخته نمی‌شوند. Plan تولیدشده همیشه `MANAGED` و دارای پرچین پایه است.
رکورد فاقد Price Contract معتبر یا Availability در همان Sync غیرفعال و حفظ
می‌شود.

صفحه `/ready-servers` با `no-store` در هر بار Render کاتالوگ Provider را
دوباره می‌خواند، Persist می‌کند و تمام انتخاب‌های معتبر را نمایش می‌دهد. اگر
Provider یا قرارداد قیمت قابل تأیید نباشد، صفحه Fail-closed است و قیمت
Cacheشده را به‌عنوان قیمت زنده نمایش نمی‌دهد.

`parchinIncluded` در پلن فعلی فقط «پرچین پایه» یعنی کنترل تحویل و دسترسی
یک‌بارمصرف را نشان می‌دهد. این مقدار نباید به‌عنوان قابلیت Backup یا Monitoring
به موتور پیشنهاد داده شود. بکاپ روزانه برای نیازهای پرریسک یک شرط سخت است و تا
اتصال قابلیت واقعی، خرید خودکار آن نیاز متوقف می‌ماند.

## Markup و قیمت نهایی

`ProviderPricingConfig` برای ParsPack فقط یک `markupBasisPoints` سراسری دارد.
ادمین درصد Markup را ویرایش می‌کند؛ Base Price، Resources و Final Price
Read-only هستند. Provider Cost، Sale Price و Renewal Price قدیمی فقط برای
سازگاری Schema و Rollback حفظ شده‌اند و Source of Truth نیستند.

فرمول داخلی:

```text
providerBasePriceRial = ceil(providerMonthlyAmount × rialMultiplier / 10^6)
finalPriceRial = ceil(providerBasePriceRial × (10000 + markupBasisPoints) / 10000)
```

برای مثال قرارداد Toman، قیمت پایه `500000` و Markup `25%`، به
`6,250,000 IRR` یا `625,000 تومان` می‌رسد. گردکردن همیشه رو‌به‌بالا تا یک ریال
است و با تست پوشش داده شده است.

## Quote، Payment و Renewal

Quote خرید ده دقیقه اعتبار دارد و Catalog Item، Region، Size، Image، منابع،
Base Price، Markup، Final Price، Currency و زمان بررسی قیمت را Snapshot
می‌کند. قبل از برداشت کیف پول، Catalog Item و Availability دوباره خوانده
می‌شوند. تغییر قیمت Quote قبلی را رد می‌کند و یک Quote جدید Customer-safe
می‌سازد؛ نام Provider و Base Price در پاسخ مشتری وجود ندارند.

مهمان می‌تواند از `/ready-servers` Quote بسازد و همان URL را پس از ورود یا
ثبت‌نام ادامه دهد. Region، Size، Image، Provider و حالت تحویل از Snapshot همان
Quote خوانده می‌شوند. پیش از پرداخت علاوه بر Price و Availability، تطبیق کامل
این تنظیمات Revalidate می‌شود. Worker هنگام ساخت، Region/Size/Image را از
`ServiceOrder.planSnapshot` پرداخت‌شده می‌خواند؛ بنابراین تغییر بعدی Plan یا
Sync باعث Provider/Configuration Swap نمی‌شود.

Order پرداخت‌شده قبل از Revalidation بازگردانده می‌شود و مبلغ یا Snapshot آن
با Sync یا تغییر Markup تغییر نمی‌کند. `requiredFundingRial` از Snapshot
تأییدشده همان پرداخت می‌آید.

تمدید خودکار و Auto-charge وجود ندارد. Customer ابتدا یک Renewal Quote
ده‌دقیقه‌ای با قیمت فعلی می‌گیرد و سپس همان قیمت را تأیید و پرداخت می‌کند.
قبل از برداشت، قیمت و Availability دوباره Revalidate می‌شوند و هر تمدید
Snapshot و Ledger idempotency مستقل دارد.

## Migration، Rollback و سازگاری داده

Migration `20260729200000_parspack_catalog_pricing` فقط enum، جدول، index،
foreign key و ستون nullable/defaultدار اضافه می‌کند. جدول مالی، Order،
Transaction یا Snapshot قبلی حذف/بازنویسی نمی‌شود. ستون‌های قیمت دستی قدیمی
برای rollback کد حفظ شده‌اند، ولی Flow جدید آن‌ها را نمی‌خواند. تنها data
update، خاموش‌کردن `autoRenew=true` قدیمی است تا پس از ارتقا برداشت خودکار رخ
ندهد. Rollback اپلیکیشن می‌تواند ستون‌های قدیمی را بخواند؛ rollback دیتابیس
نیازی به پاک‌کردن داده جدید ندارد.

ساخت Planهای `READY_PARSPACK_` به Migration جدید نیاز ندارد و روی Schema
additive موجود انجام می‌شود. Rollback کد می‌تواند این Planهای تولیدشده را
نادیده بگیرد یا غیرفعال کند، بدون اینکه Quote، Order، Ledger یا Snapshot
پرداخت‌شده تغییر کند.
