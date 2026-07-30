# معماری چندارائه‌دهنده‌ای زیرساخت ابرچین

## Routing قطعی محصول

Routing سمت Server اعمال می‌شود و ورودی Client نمی‌تواند آن را عوض کند:

| Product Kind | Provider | API |
| --- | --- | --- |
| `READY_INSTANT_SERVER` | ParsPack | `v1` |
| `CLOUD_SERVER` | ArvanCloud | IaaS `v1` |

`CLOUD_SERVER + PARSPACK` و `READY_INSTANT_SERVER + ARVAN` رد می‌شوند. Provider
و API Version پیش از Quote در Snapshot قفل می‌شوند و Order پرداخت‌شده فقط از
همان Snapshot برای Provisioning استفاده می‌کند. Provider Swap پس از پرداخت
وجود ندارد. Arvan API v3 غیرفعال است و Base URL حاوی `/v3` پیش از هر Network
Call رد می‌شود.

مسیر `/cloud-servers` فقط Planهای Regionمحور آروان را نمایش می‌دهد. مسیر
`/ready-servers` فقط سرورهای آمادهٔ ParsPack را با منابع ثابت نشان می‌دهد.
Plan ناموجود، `STALE`، بدون قیمت یا ناسازگار با Image اصلاً به Customer
برگردانده نمی‌شود.

## Arvan IaaS v1

Root عملیاتی:

```text
https://napi.arvancloud.ir/ecc/v1
```

مقدار `ARVAN_API_BASE_URL` می‌تواند مطابق تنظیم عملیاتی به `/regions` ختم شود؛
Adapter آن را به Root بالا Normalise می‌کند. احراز هویت فقط Server-side است:

```http
Authorization: Apikey ${ARVAN_API_KEY}
Accept: application/json
```

Catalog از این GETها می‌آید:

```text
GET /regions
GET /regions/{region}/sizes
GET /regions/{region}/images?type=distributions
GET /regions/{region}/networks
GET /regions/{region}/securities
```

هیچ Region، Plan، Image یا قیمت فروش Hardcode نشده است. هویت Plan منطقه‌ای
است:

```text
arvan:v1:{region}:{externalPlanId}
```

بنابراین یک `externalPlanId` در دو Region دو `ProviderCatalogItem` مستقل دارد.
قیمت ماهانه فقط از `price_per_month` خوانده می‌شود؛ `price_per_hour × 720`
مبنای Quote نیست.

مسیرها و Payloadهای Lifecycle از
[`arvancloud/terraform-provider-arvan`](https://github.com/arvancloud/terraform-provider-arvan)
در Commit رسمی `80747ecaf2b34c143e245878a0b365c403173966` استخراج شده‌اند:

```text
POST   /regions/{region}/servers
GET    /regions/{region}/servers/{id}
POST   /regions/{region}/servers/{id}/power-on
POST   /regions/{region}/servers/{id}/power-off
POST   /regions/{region}/servers/{id}/reboot
POST   /regions/{region}/servers/{id}/resize
DELETE /regions/{region}/servers/{id}?forceDelete=true
```

Create payload شامل `name`، `network_ids`، `flavor_id`، `image_id`،
`security_groups`، `ssh_key`، `key_name`، `count`، `create_type`، `disk_size`،
`init_script` و `ha_enabled` است. قرارداد رسمی v1 یک Task endpoint جدا تعریف
نمی‌کند؛ Create، Resource ID را برمی‌گرداند و Inquiry با GET همان Server انجام
می‌شود. Request ID هدر در Log عملیاتی ذخیره می‌شود.

در این نسخه `ARVAN_MUTATIONS_ENABLED=false` است. صرف تنظیم API Key هیچ
POST/DELETEای را فعال نمی‌کند. فعال‌سازی Lifecycle فقط پس از پذیرش صریح یک
سرور Staging ارزان مجاز است. تا قبل از آن Quote کاتالوگ قابل بررسی است، اما
Payment سفارش آروان پیش از Debit متوقف می‌شود؛ ابرچین برای قابلیتی که هنوز
Provisioning آن فعال نشده از Customer وجه دریافت نمی‌کند.

## ParsPack v1

ParsPack فقط `READY_INSTANT_SERVER` است. Catalog از این Endpointها می‌آید:

```text
GET https://my.parspack.com/cserver/api/public/v1/regions
GET https://my.parspack.com/cserver/api/public/v1/sizes
GET https://my.parspack.com/cserver/api/public/v1/images
```

هویت داخلی:

```text
parspack:v1:{region}:{sizeSlug}
```

Size بدون Region قطعی با `__unscoped__` حفظ ولی غیرقابل فروش می‌شود. مسیر
آماده Slider سفارشی CPU/RAM/Disk ندارد و Hybrid، Macro، Bare Metal یا
محصولات غیر Cloud Server را وارد نمی‌کند.

واحد `price_hourly` و `price_monthly` باید با
`PARSPACK_PRICE_CURRENCY=IRR` و `PARSPACK_PRICE_AMOUNT_UNIT=RIAL|TOMAN`
مطابق Contract رسمی تنظیم شود. بدون آن، مقدار خام Persist ولی فروش Fail-closed
می‌شود.

## Persist و Sync

`ProviderCatalogItem` علاوه بر فیلدهای Legacy این اطلاعات را نگه می‌دارد:

- Provider، API Version، Product Kind و کلید خارجی منطقه‌ای؛
- vCPU، RAM، Disk و Imageهای سازگار؛
- قیمت ساعتی و ماهانهٔ نرمال‌شده به IRR (`BigInt`)؛
- `status` از `ACTIVE | STALE | UNAVAILABLE | INVALID_PRICE | DISABLED`؛
- `lastSeenAt`، `lastSyncedAt`، `rawUpdatedAt`، `catalogVersion`؛
- Payload JSON و SHA-256 آن.

Image، Network و Security در `ProviderCatalogAsset` و سلامت هر Region در
`ProviderCatalogRegionState` ذخیره می‌شوند. هر Sync یک
`ProviderCatalogSyncRun` با مدت، Count و خطاهای Sanitized دارد.
Request ID امن آخرین فراخوانی در وضعیت Region/Provider ثبت می‌شود و Admin
گزارش Syncهای اخیر را می‌بیند؛ Header احراز هویت هرگز در این گزارش‌ها ذخیره
نمی‌شود.

Sync Upsert و Idempotent است. فقط پس از Sync کامل و موفق یک Region، رکوردهای
دیده‌نشدهٔ همان Region `STALE` می‌شوند. خطای یک Region دادهٔ سالم Regionهای
دیگر یا Last-known-good همان Region را خراب نمی‌کند. هیچ Catalog Itemی Hard
Delete نمی‌شود و Quote/Orderهای تاریخی تغییر نمی‌کنند.

Sync دستی از پنل Admin در دسترس است. Worker نیز با
`CATALOG_SYNC_INTERVAL_MS` (پیش‌فرض پنج دقیقه) Sync امن و Read-only هر
Provider تنظیم‌شده را اجرا می‌کند؛ شکست یک Provider مانع Sync Provider دیگر
یا پردازش Provisioning نمی‌شود.

## پول، Markup، پرچین و مالیات

واحد داخلی همه مبالغ `IRR` و نوع Database `BigInt` است. تبدیل نمایش:

```text
Toman = IRR / 10
```

هر Adapter واحد منبع خودش را با `normalizeProviderMoney` به IRR تبدیل می‌کند.
هیچ تبدیل Provider در UI یا Order Service پخش نشده است.

قیمت Quote:

```text
Provider Infrastructure Cost
+ Infrastructure Markup (Provider BPS + Product Kind BPS)
+ Mandatory Parchin
+ Provider Add-ons
+ Tax
= Final Quote
```

تمام ضرب‌های BPS Integer هستند و division با Round-up تا یک ریال انجام
می‌شود. مالیات روی Subtotal پیش از Tax اعمال می‌شود. مقدار پیش‌فرض Tax
`1000 bps` یا ۱۰٪ است. Markup، پرچین، Add-on و Tax Line Itemهای مستقل Quote و
Invoice هستند.

سطوح پرچین:

```text
PARCHIN_START < PARCHIN_ACTIVE < PARCHIN_STABLE
```

هیچ Plan `RAW` یا بدون پرچین قابل فروش نیست. Admin قیمت و فعال‌بودن هر سطح را
تنظیم می‌کند؛ Customer نمی‌تواند سطحی پایین‌تر از Minimum Plan انتخاب کند.
در Conversation کاربر می‌تواند همان Minimum یا یک سطح بالاتر را انتخاب کند؛
تغییر سطح، Quote قبلی همان Session را Invalid و Quote تازه را با Line Item
پرچین جدید ایجاد می‌کند.
قیمت Migration برای `PARCHIN_START` صفر باقی می‌ماند تا قیمت مصوب Admin ثبت
شود؛ وجود Line Item و الزام سطح از ابتدا برقرار است.

Minimum پرچین با قواعد قطعی ریسک انتخاب می‌شود: نیاز کم‌ریسک از
`PARCHIN_START`، نیاز فعال یا داده‌ای از `PARCHIN_ACTIVE` و نیاز حساس یا
فروش پرترافیک از `PARCHIN_STABLE` شروع می‌شود. سطح غیرفعال یا بدون قیمت
مصوب Admin به‌جای Downgrade پنهان، فروش را متوقف می‌کند.

Technology محصول یا Package نیست. موتور پاسخ‌ها را فقط برای Support و
Health Check به یکی از `GENERAL_LINUX`, `WINDOWS`, `WEB_APPLICATION`,
`ECOMMERCE`, `DATABASE`, `CONTAINER`, `API`, `WORKER`, `AI_LIGHT`,
`CUSTOM` طبقه‌بندی می‌کند. این Classification قیمت Provider را تغییر
نمی‌دهد.

## Quote، Payment و Renewal

Quote ده دقیقه معتبر است و Provider/API/Product، Region، Plan، Image،
Network، Security، منابع، قیمت Provider، Markup، پرچین، Add-on، Tax، قیمت
نهایی، زمان، Catalog Version و Payload Hash را Snapshot می‌کند.

پیش از Payment، Catalog و Selection دوباره Refresh می‌شوند. تغییر Price،
Availability، Image compatibility، Tax، Markup یا پرچین فقط همان Quote
پرداخت‌نشده را Invalid می‌کند؛ Conversation و Answerها باقی می‌مانند. Order
پرداخت‌شده هرگز با Sync یا تغییر تنظیمات Reprice نمی‌شود.

Renewal Auto-charge ندارد. هر تمدید Quote مستقل ده‌دقیقه‌ای و Snapshot مستقل
می‌گیرد و پیش از برداشت دوباره Revalidate می‌شود.

## Conversation و State Machine

Session گفتگو در `RecommendationSession` Persist می‌شود. Token مهمان فقط
به‌صورت SHA-256 در Database است؛ Browser اصل Token و State نمایشی را صرفاً به
عنوان Cache در `sessionStorage` نگه می‌دارد. پس از Login، Endpoint Claim همان
Session را به User وصل می‌کند.

Discovery چهار سؤال ثابت پُراثر و حداکثر یک سؤال تطبیقی دارد. پاسخ‌های
«نمی‌دانم»، توضیح و «کمکم کن انتخاب کنم» در قرارداد سؤال وجود دارند. ویرایش
یک Answer فقط Quoteهای Active/Selected همان Session را Invalid می‌کند.

State Machine مرجع سمت Server، مسیر `DRAFT` تا `ACTIVE` و وضعیت‌های Retry،
Reconciliation، Manual Review، Health Check failure و Cancel را تعریف می‌کند.
هر Transition با Idempotency Key در `ProductFlowTransition` ثبت می‌شود.

## Reconciliation و ایمنی

قبل از Create، Order باید Paid، Provider قفل و Idempotency Key ثبت شده باشد.
پس از Timeout، Create دوباره ارسال نمی‌شود. ابتدا Task/Resource ID و سپس نام
`abrchin-{orderPublicId}-{attempt}` Reconcile می‌شود. نبودن در یک List response
برای Retry کافی نیست؛ `noResourceConfirmedAt` باید به‌طور قطعی ثبت شود.

تمام Provider Requestها Timeout دارند. Retry محدود و Exponential Backoff فقط
برای GETهای امن است. Circuit Breaker جلوی فشار مکرر را می‌گیرد. Authorization،
API Key، Token، Password، SSH Key و Init Script از Payloadهای Log Redact
می‌شوند. Customer هیچ نام Provider، Base Price، Raw Payload یا Provider Error
دریافت نمی‌کند.

## Migration و Rollback

Migration `20260730160000_multi_provider_routing` افزایشی است:

- Enumها، ستون‌های nullable/defaultدار، Indexها و جدول‌های جدید را اضافه می‌کند؛
- Catalog ParsPack موجود را بدون حدس Region به هویت نسخه‌دار Backfill می‌کند؛
- Order، Ledger، Transaction و Snapshot پرداخت‌شده را حذف یا Reprice نمی‌کند؛
- ستون‌های Legacy قیمت و Plan را برای rollback کد نگه می‌دارد؛
- Unique قدیمی Quote revision را به Index تبدیل می‌کند تا Quote جدید در همان
  Conversation ساخته شود و Quote قبلی تاریخی بماند.

Rollback کد می‌تواند فیلدهای Legacy را بخواند. Rollback دیتابیس نیازمند حذف
داده نیست؛ جدول‌های جدید می‌توانند توسط نسخهٔ قبلی نادیده گرفته شوند.
