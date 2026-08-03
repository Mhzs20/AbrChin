# معماری چندارائه‌دهنده‌ای زیرساخت ابرچین

## Routing قطعی محصول

Routing سمت Server اعمال می‌شود و ورودی Client نمی‌تواند آن را عوض کند:

| Product Kind | Source / Provider | API |
| --- | --- | --- |
| `READY_INSTANT_SERVER` | ParsPack | `v1` |
| `READY_INSTANT_SERVER` | ArvanCloud fixed offer | IaaS `v1` |
| `READY_INSTANT_SERVER` | `MANUAL_ADMIN` / preprovisioned | Admin inventory |
| `CLOUD_SERVER` | ArvanCloud | IaaS `v1` |

`CLOUD_SERVER + PARSPACK` رد می‌شود. سرور فوری می‌تواند ParsPack، آروان یا
موجودی Admin باشد، اما Source و Provider انتخاب‌شده پیش از Quote در Snapshot
قفل می‌شوند و Order پرداخت‌شده فقط از همان Snapshot برای Provisioning یا
تحویل دستی استفاده می‌کند. Provider Swap پس از پرداخت وجود ندارد. Arvan API
v3 غیرفعال است و Base URL حاوی `/v3` پیش از هر Network Call رد می‌شود.

مسیر `/cloud-servers` فقط Planهای Regionمحور آروان را نمایش می‌دهد. مسیر
`/ready-servers` کاتالوگ واحد پلن‌های ثابت ParsPack، آروان و Admin را نشان می‌دهد.
Plan ناموجود، بدون قیمت یا ناسازگار با Image قابل خرید نیست. هنگام اختلال
Provider، فقط Planهایی که Admin برای حالت Last-known-good مجاز کرده می‌تواند
با برچسب روشن نمایش داده شود؛ Quote آن تا بازیابی Provider غیرفعال است. تعریف
دستی Plan یا ظرفیت عددی Admin هیچ‌وقت اثبات‌کنندهٔ موجودی قابل‌تحویل نیست.

## Arvan IaaS v1

Root عملیاتی:

```text
https://napi.arvancloud.ir/ecc/v1
```

`ARVAN_API_BASE_URL` باید همین Root باشد. مقدار قدیمی ختم‌شونده به `/regions`
فقط برای سازگاری استقرار قبلی به Root بالا Normalise می‌شود و Warning
ساختاریافتهٔ بدون URL/Secret می‌دهد. احراز هویت فقط Server-side است:

```http
Authorization: Apikey ${ARVAN_API_KEY}
Accept: application/json
```

Region عملیاتی از جدول `ProviderRegionConfig` خوانده می‌شود و از پنل Admin
قابل افزودن، اعتبارسنجی، فعال/غیرفعال‌کردن برای Sync و فروش است. متغیر زیر
فقط Bootstrap اختیاری اولین استقرار است و پس از ساخته‌شدن اولین Row دیگر
مرجع Runtime نیست:

```text
ARVAN_REGION_CODES=ir-thr-si1,ir-thr-fr1,ir-tbz-sh1,ir-thr-ba1,ir-southwest1-a,eu-west1-a
```

CSV در Startup Trim، Deduplicate و Validate می‌شود. Env خالی مجاز است تا
Region از Admin ثبت شود، اما Sync بدون Region فعال دیتابیسی Fail-closed است.
افزودن یا فعال‌کردن Region با GETهای Regionمحور اعتبارسنجی می‌شود؛ هیچ
fallback به `/details`، Root `/regions` یا فهرست Hardcoded داخل Adapter وجود
ندارد. کد Region هویت Provider است و نام نمایشی در همین تنظیم دیتابیسی
نگهداری می‌شود.

Catalog هر Region از این GETها می‌آید:

```text
GET /regions/{region}/sizes
GET /regions/{region}/images?type=distributions
GET /regions/{region}/networks
GET /regions/{region}/securities
GET /regions/{region}/servers/options
```

هیچ Region، Plan، Image یا قیمت فروش Hardcode نشده است. هویت Plan منطقه‌ای
است:

```text
arvan:v1:{region}:{externalPlanId}
```

بنابراین یک `externalPlanId` در دو Region دو `ProviderCatalogItem` مستقل دارد.
نرخ ساعتی و ماهانه فقط از فیلد صریح همان واحد خوانده می‌شوند. Adapter حق ندارد
واحد یا Currency را حدس بزند. تبدیل نرخ ساعتی/ماهانه به Estimate روزانه فقط با
Billing Policy نسخه‌دار Provider انجام می‌شود و مبنای Retroactive نیست.

فیلد `memory` آروان در این قرارداد GB است و فقط داخل Adapter به MB تبدیل
می‌شود. اگر `memory_in_bytes` معتبر موجود باشد مقدار دقیق آن ترجیح داده
می‌شود؛ ناسازگاری دو فیلد فروش را با `INVALID_RESOURCE` متوقف می‌کند. Disk
نیز با `disk_in_bytes` کنترل می‌شود. Network پیش‌فرض از `network_id` پاسخ
`servers/options` و Security پیش‌فرض فقط از `real_name=arDefault` قفل می‌شود.

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

Gateهای اتصال، فروش محصول و Mutation مستقل و Fail-closed هستند:

```text
ARVAN_ENABLED=false
ARVAN_PUBLIC_SALE_ENABLED=false
ARVAN_READY_PUBLIC_SALE_ENABLED=false
ARVAN_CLOUD_PUBLIC_SALE_ENABLED=false
ARVAN_MUTATIONS_ENABLED=false
MANUAL_READY_PUBLIC_SALE_ENABLED=false
```

Gate عمومی آروان همراه Gate نوع محصول، Listing، Delivery Options، Estimate و
Activation Request را کنترل می‌کند و پیش‌فرض `false` است. Admin، Catalog Sync،
Region Validation و Observation موجودی با خاموش‌بودن آن فعال می‌مانند.
`API_CATALOG` و `MANUAL_API_BACKED` به Sale Gate، Rate/Availability freshness و
Revalidation موفق نیاز دارند؛ Mutation Gate فقط هنگام Dispatch واقعی و پس از
Admin Approval بررسی می‌شود. Sale روشن با Mutation خاموش Estimate، Wallet
Top-up و Activation را مجاز و Fulfillment را دستی/کنترل‌شده می‌کند.
`MANUAL_ADMIN` و `PREPROVISIONED_INVENTORY` با Gate مستقل Manual کنترل می‌شوند
و هرگز `createServer` اجرا نمی‌کنند.

صرف تنظیم API Key هیچ POST/DELETEای را فعال نمی‌کند. فعال‌سازی Lifecycle فقط
پس از تأیید عملیاتی Founder مجاز است؛ در کد و نمونه Environment تمام Gateهای
فروش و Mutation بالا `false` باقی می‌مانند.

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

سه Gate ParsPack مستقل‌اند: `PARSPACK_ENABLED` فقط اتصال و Sync،
`PARSPACK_PUBLIC_SALE_ENABLED` فروش عمومی و `PARSPACK_MUTATIONS_ENABLED`
ساخت Resource را کنترل می‌کند. Sale برای Estimate/Request به Mutation وابسته
نیست؛ Dispatch واقعی هر دو Admin Approval و Mutation Gate را می‌خواهد. همه
مقادیر به‌صورت پیش‌فرض `false` هستند.

## Persist و Sync

`ProviderCatalogItem` علاوه بر فیلدهای Legacy این اطلاعات را نگه می‌دارد:

- Provider، API Version، Product Kind و کلید خارجی منطقه‌ای؛
- vCPU، RAM، Disk و Imageهای سازگار؛
- قیمت ساعتی و ماهانهٔ نرمال‌شده به IRR (`BigInt`)؛
- `status` از `ACTIVE | STALE | UNAVAILABLE | INVALID_PRICE | INVALID_RESOURCE | DISABLED`؛
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

Sync فقط Catalog خام را مالک است و دیگر `InfrastructurePlan` فروشگاه را
نمی‌سازد یا منتشر/غیرفعال نمی‌کند. Admin از Catalog آروان، Planهای موردنظر
`/cloud-servers` را با وضعیت `DRAFT | PUBLISHED | PAUSED | ARCHIVED` انتخاب
می‌کند. بنابراین اضافه‌شدن صدها Flavor در Provider به معنی نمایش خودکار آن‌ها
به Customer نیست.

منشأ Catalog و قرارداد فروش دو مفهوم جدا هستند. `API_CATALOG` از Sync Provider
می‌آید و `MANUAL_API_BACKED` فقط اجازه می‌دهد Admin Plan و قیمت را تعریف کند؛
هر دو برای Estimate و Activation به Revalidation موفق Provider نیاز دارند.
ظرفیت عددی Admin هیچ‌وقت جای Availability واقعی Provider را نمی‌گیرد و هنگام
قطعی صرفاً Last-known-good قابل مشاهده است، نه قابل فعال‌سازی.

`MANUAL_ADMIN` SKU، قیمت و تعداد قابل‌تحویل Admin را نگه می‌دارد؛ Sync هیچ
Providerی آن را تغییر نمی‌دهد. برای `PREPAID_TERM` رزرو تعداد در Transaction
Checkout انجام می‌شود. برای `PAYG_WALLET` رزرو/تخصیص فقط پس از Activation و
Admin Approval اول انجام می‌شود. هر دو مسیر Oversell را با Row Lock منع
می‌کنند و هیچ Provider Mutation خودکاری ندارند.

`PREPROVISIONED_INVENTORY` فقط برای Resource ازپیش‌ساختهٔ واقعی است. هر سرور
یک Row مستقل با شناسهٔ یکتای `provider + apiVersion + providerResourceId`،
Region/Plan/Image، IP، Observation و Health تازه دارد. State موجودی از
`AVAILABLE | RESERVED | ASSIGNED | DELIVERED | UNHEALTHY | STALE | DISABLED`
است. ثبت موجودی فقط پس از GET خواندنی آروان، تطبیق کامل Snapshot و Probe واقعی
SSH/RDP انجام می‌شود؛ شناسهٔ Resource فقط در Snapshot داخلی می‌ماند.

هر Row موجودی باید یک `PreprovisionedInventoryCredential` با وضعیت `READY`
داشته باشد. Password با همان AES-256-GCM و
`CREDENTIAL_ENCRYPTION_KEY` مکانیزم Credential فعلی رمز می‌شود؛ Fingerprint
کلیددار فقط برای رد Password مشترک میان دو Resource استفاده می‌شود. Secret خام
در Log، Audit، Quote، Snapshot، پیامک یا Response قرار نمی‌گیرد. مشاهدهٔ سالم
بدون Credential تنها `STALE` است و ظرفیت قابل‌فروش محسوب نمی‌شود.

Quote داخل Transaction و با `FOR UPDATE SKIP LOCKED` دقیقاً یک Row سالم را تا
انقضای Quote رزرو می‌کند. انقضای Quote یا شکست Payment رزرو را Idempotent آزاد
می‌کند. Debit موفق همان Row را به همان Order Assign می‌کند؛ Retry دوباره Debit
یا Assignment نمی‌سازد و Worker فقط Health/Delivery همان Resource را ادامه
می‌دهد، بدون `createServer`، Provider fallback یا Swap.

در `PREPAID_TERM`، Checkout می‌تواند Inventory را با Row Lock رزرو کند. در
`PAYG_WALLET`، Wallet Top-up هیچ Inventory یا Credential را لمس نمی‌کند؛
Assignment فقط پس از Approval اول است. Assignment، ساخت `CloudInstance`، کپی
Ciphertext و تغییر Credential موجودی به `TRANSFERRED` در Transaction
Idempotent انجام می‌شوند. شکست هر مرحله همه Writeها را Rollback می‌کند؛ Secure
Delivery نیز همان مکانیزم نمایش یک‌بارمصرف را استفاده می‌کند.

پاسخ `401/403` ParsPack با کد امن `provider_auth_failed` و بدون Retry ثبت
می‌شود. شکست Provider، Timeout، ناسازگاری Response Contract و شکست
Persistence کدهای جدا دارند. هر تلاش ParsPack، حتی در صورت شکست، یک
`ProviderCatalogSyncRun` و نتیجهٔ Sanitized در `ProviderCatalogState` دارد؛
Token، Header احراز هویت و Response خام در Log، Audit یا Admin ذخیره نمی‌شود.

Sync دستی از پنل Admin در دسترس است. Worker نیز با
`CATALOG_SYNC_INTERVAL_MS` (پیش‌فرض پنج دقیقه) Sync امن و Read-only هر
Provider تنظیم‌شده را اجرا می‌کند؛ شکست یک Provider مانع Sync Provider دیگر
یا پردازش Provisioning نمی‌شود.

درخواست Customer Full Catalog Sync اجرا نمی‌کند. صفحه Catalog دیتابیس را
می‌خواند؛ اگر SLA گذشته باشد `syncRequestedAt` برای Worker ثبت می‌شود. دادهٔ
Last-known-good بنا بر تنظیم Plan می‌تواند صرفاً برای مشاهده باقی بماند و خرید
Catalog API تا بازیابی ارتباط Fail-closed است. Lease دیتابیسی از Sync همزمان
جلوگیری می‌کند. Selection قفل‌شدهٔ Catalog API پیش از Quote و Payment با
GETهای هدفمند Provider دوباره اعتبارسنجی می‌شود؛ قرارداد دستی API-backed نیز
همین Revalidation را دور نمی‌زند. فقط موجودی ازپیش‌ساختهٔ سالم و تازه که اتمیک
رزرو شده باشد می‌تواند در قطعی موقت Catalog خریداری شود.

## Incident و SMS عملیاتی

شکست کامل Sync یا خطای Auth یک `OperationalIncident` بحرانی و یکتا می‌سازد؛
اختلال جزئی Region به‌عنوان Warning ثبت می‌شود. AdminNotification همیشه در
پنل باقی می‌ماند و برای Incident بحرانی، شماره‌های Admin و `ADMIN_MOBILES`
یک `OperationalAlertOutbox` دریافت می‌کنند. Worker پیامک را با Template
مجزای `KAVENEGAR_ALERT_TEMPLATE`، حداکثر سه تلاش و Backoff نمایی می‌فرستد.
ارسال پیامک داخل Transaction Sync نیست و شکست SMS Catalog سالم را تغییر
نمی‌دهد. API Key، Authorization، Response خام و Connection String هرگز در
Incident، Outbox یا متن پیام ذخیره نمی‌شود.

اگر Provider پیامک Kavenegar، Template هشدار یا شمارهٔ Admin تنظیم نشده باشد،
Web و Worker Crash نمی‌کنند. وضعیت عملیاتی `CONFIG_REQUIRED` در Admin نمایش
داده می‌شود و Alertهای Pending تا تکمیل تنظیمات بدون Claim اشتباه حفظ می‌شوند.
فروش عمومی ParsPack نیز با `PARSPACK_PUBLIC_SALE_ENABLED=false` مستقل از Sync
غیرفعال می‌ماند؛ Catalog و Route قطعی ParsPack حذف یا به آروان منتقل نمی‌شوند.

## پول، Markup، پرچین و هزینه‌های صریح

واحد داخلی همه مبالغ `IRR` و نوع Database `BigInt` است. تبدیل نمایش:

```text
Toman = IRR / 10
```

هر Adapter واحد منبع خودش را با `normalizeProviderMoney` به IRR تبدیل می‌کند.
هیچ تبدیل Provider در UI یا Order Service پخش نشده است.

قیمت Quote:

```text
Provider component rates
+ Admin percentage markup
+ Explicit measurable add-ons
+ Explicit one-time charges
= Customer estimate / invoice lines
```

تمام ضرب‌های BPS Integer هستند و Rounding از Billing Policy Provider می‌آید.
Markup فقط درصد Admin است. مالیات یا هزینه پنهان بدون قرارداد و تنظیم صریح
اضافه نمی‌شود. Add-on، Traffic و One-time charge فقط با Line Item مستقل،
واحد قابل‌اندازه‌گیری و Snapshot معتبر وارد Invoice می‌شوند.

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

## Estimate، Wallet و Billing

Estimate ده دقیقه معتبر است و Provider/API/Product، Region، Plan، Image،
Network، Security، Resource، RateCardVersion، Markup، Add-on و Payload Hash را
Snapshot می‌کند.

پیش از Activation، Catalog و Selection دوباره Refresh می‌شوند. تغییر Rate،
Availability، Image compatibility یا Markup فقط Estimate را Invalid می‌کند؛
Conversation و Wallet Credit باقی می‌مانند.

درگاه بانکی فقط Wallet Top-up می‌سازد. Callback پس از Verify رسمی و با Ledger
Idempotent کیف پول را یک‌بار Credit می‌کند. شارژ Wallet، Order را Debit،
Activation را Approve یا Resource را Provision نمی‌کند.

Activation Request پس از بررسی حداقل اعتبار ثبت می‌شود. Approval اول Admin،
Provision کنترل‌شده و Provider Confirmation به‌ترتیب انجام می‌شوند. Billing از
`ResourceVersion.effectiveFrom` شروع و بر اساس UsageInterval و RateCardVersion
نسخه‌دار Settlement می‌شود. Wallet ناکافی Invoice کامل و Outstanding می‌سازد
و منفی نمی‌شود.

`PREPAID_TERM` Checkout و Renewal دستی مستقل دارد. Renewal Auto-charge ندارد و
نباید با Usage Billing Cloud مخلوط شود.

برای جلوگیری از Markup دوبل، Migration چندارائه‌دهنده Markup قدیمی ParsPack
را فقط در `ProviderPricingConfig` نگه می‌دارد و
`ProductPricingConfig` متناظر را با صفر Seed می‌کند. Runtime جمع این دو BPS
را محاسبه می‌کند.

## Conversation و State Machine

Session گفتگو در `RecommendationSession` Persist می‌شود. Token مهمان فقط
به‌صورت SHA-256 در Database و اصل آن فقط در Cookie `HttpOnly`, `SameSite=Lax`
نگه‌داری می‌شود؛ `sessionStorage` صرفاً Cache نمایشی و Session ID است. GET
عمومی Resume برای کاربر واردشده با `userId` و برای مهمان با Hash همان Cookie
جست‌وجو می‌کند؛ بنابراین مهمان هم پس از پاک‌شدن Storage همان گفت‌وگوی
ناتمام را Resume می‌کند. Token جعلی/منقضی Fail-closed است. Claim موفق Token
مهمان را باطل می‌کند و Order فقط Session صریحاً Claim‌شده را می‌پذیرد.

Discovery چهار سؤال ثابت پُراثر و حداکثر یک سؤال تطبیقی دارد. پاسخ‌های
«نمی‌دانم»، توضیح و «کمکم کن انتخاب کنم» در قرارداد سؤال وجود دارند. ویرایش
یک Answer فقط Quoteهای Active/Selected همان Session را Invalid می‌کند.

State Machine یکتای سمت Server، مسیر `DRAFT` تا `ACTIVE` و وضعیت‌های Retry،
Reconciliation، Manual Review، Health Check failure و Cancel را تعریف می‌کند.
هر Transition با Idempotency Key، Owner Fingerprint و Revision خوش‌بینانه در
`ProductFlowTransition` ثبت می‌شود. Answerها نیز `expectedRevision` دارند و
Conflict پاسخ `409` با Snapshot فعلی Sanitized می‌دهد. ویرایش Answer و
باطل‌کردن Quote در یک Transaction انجام می‌شود.

تنظیم تحویل واقعی شامل Region، Plan، Image و برای Arvan شبکه/Security
پیش‌فرض واقعی است. Linux با رمز یک‌بارمصرف یا نام SSH Key ثبت‌شده و Windows
فقط با مسیر رمز یک‌بارمصرف Windows پذیرفته می‌شود. Startup Script و Backup
تا وقتی قابلیت و قیمت واقعی نداشته باشند `null` می‌مانند و به Customer وعده
داده نمی‌شوند. این تنظیم همراه سطح پرچین پیش از
`DELIVERY_CONFIGURED → QUOTED` Persist و Snapshot می‌شود؛ Quote دیگر این
Transition را به‌صورت فرضی تولید نمی‌کند.

مسیر حرفه‌ای `/cloud-servers` نیز همین قرارداد را استفاده می‌کند. ارسال
تنها `planId` قابل Quote نیست: Customer باید Image/OS و یکی از
`SSH_KEY`, `ONE_TIME_PASSWORD`, `WINDOWS_PASSWORD` را صریحاً انتخاب کند؛
Windows فقط رمز Windows و Linux فقط SSH Key یا رمز یک‌بارمصرف می‌پذیرد.
Network و Security پیش‌فرض Region در Server دوباره Resolve و Validate
می‌شوند. برای SSH، Adapter فقط
`GET /regions/{region}/ssh-keys` را طبق Provider رسمی Terraform می‌خواند و
نام/ID/Fingerprint را قفل می‌کند؛ Private Key هرگز دریافت یا ذخیره نمی‌شود.
سرور آماده نیز Image واقعی Catalog و روش دسترسی بدون ابهام را Snapshot
می‌کند.

ورود از Catalog مستقیم نیز State Machine را دور نمی‌زند. درخواست باید
`Idempotency-Key` معتبر داشته باشد؛ همان Key و همان Payload دقیقاً همان
Session/Quote را برمی‌گرداند و استفادهٔ دوباره از Key با Payload متفاوت رد
می‌شود. Session از `DRAFT` ساخته و Transitionهای
`UNDERSTANDING_CONFIRMED → REQUIREMENTS_COMPLETE → RECOMMENDED →
PARCHIN_SELECTED → DELIVERY_CONFIGURED → QUOTED` از سرویس مرکزی ثبت
می‌شوند. بنابراین مسیر حرفه‌ای هم Transition، Revision و Audit کامل دارد.

پس از ساخت، صرف وجود IP کافی نیست: State Provider باید `active`، IP باید
معتبر و Timestamp مشاهده باید ثبت شده باشد. کنترل Topology بر مبنای Capability
قفل‌شدهٔ Adapter است:

- آروان `STRICT_OBSERVED` است؛ Network و Security مشاهده‌شده باید دقیقاً با
  Snapshot قفل‌شده برابر باشند و مقدار `null` یا mismatch شکست است.
- ParsPack `PROVIDER_MANAGED` است؛ چون API مشاهدهٔ مستقل Network/Security
  ارائه نمی‌کند، این دو مقدار `null` ذخیره می‌شوند ولی State/IP/Timestamp و
  Probe سلامت همچنان اجباری‌اند. Snapshotهای Legacy با
  `provider-default` فقط برای سازگاری خوانده و به همین حالت normalize
  می‌شوند.

سپس اتصال TCP محدود SSH یا RDP Audit می‌شود. برای Password، اشتراک فقط پس از
Credential رمزنگاری‌شدهٔ یک‌بارمصرف فعال می‌شود؛ برای `SSH_KEY` تحویل یک
Artifact غیرمحرمانه است و نبود Password مانع Activation نیست. شکست به
`HEALTH_CHECK_FAILED` یا `DELIVERY_RETRYABLE` می‌رود.

Health Retry یک Job مستقل `health_check_retry` است و هیچ Createای اجرا
نمی‌کند. هر تلاش ابتدا Resource موجود را با GET/Reconciliation مشاهده و سپس
Health Check را تکرار می‌کند. Jobها Lease و Claim اتمیک دارند، با Backoff
نمایی از ۳۰ ثانیه و سقف سه تلاش اجرا می‌شوند. Admin فقط با Role معتبر،
Origin معتبر، دلیل اجباری و Idempotency Key می‌تواند Retry فوری درخواست کند.
پس از اتمام سقف، جریان به `PROVISIONING_MANUAL_REVIEW` و وضعیت Order به
`MANUAL_REVIEW` می‌رود، آخرین State/IP/Network/Security و زمان مشاهده در
Metadata انتقال ثبت و Notification مدیریتی ساخته می‌شود.

`MANUAL_REVIEW` بن‌بست نیست. Admin دو عملیات مستقل و Idempotent دارد:
`health_check_manual_observe` فقط Resource ID قفل‌شده را با GET/Reconciliation
مشاهده و Observation تازه را Audit می‌کند؛
`health_check_manual_recovery` پس از اصلاح انسانی، Job جداگانه‌ای می‌سازد و
Transition رسمی `PROVISIONING_MANUAL_REVIEW → HEALTH_CHECKING` را اجرا
می‌کند. موفقیت به Delivery/Activation ادامه می‌دهد و شکست بدون افزودن تلاش
خودکار، همراه Actor/Reason/Observation به Manual Review بازمی‌گردد. شمارنده
Manual از سقف سه Retry خودکار مستقل است و هیچ‌کدام `createServer` را صدا
نمی‌زنند. یک Partial Unique Index اجرای هم‌زمان Retry و Recovery را برای یک
Order منع می‌کند.

Refund سفارش `PREPAID_TERM` نیز در Transaction واحد انجام می‌شود:
Service/Session/Infrastructure
و Wallet Rowها قفل، سند Debit و Refund معکوس بررسی، Wallet/Ledger به‌شکل
Idempotent ثبت و سپس State Machine با Reason
`wallet_refund_completed` به `CANCELLED` منتقل می‌شود. فقط سفارش فاقد
Resource فعال/مبهم و فاقد Job فعال قابل Refund است. هر شکست Transition تمام
Wallet/Ledger updateها را Rollback می‌کند.

## Reconciliation و ایمنی

قبل از Create، PREPAID Order باید Paid و PAYG Activation باید Approval اول
داشته باشد؛ Provider و Idempotency Key در هر دو قفل هستند. Worker فقط
`providerSelectionSnapshot` همان درخواست تأییدشده را می‌خواند و هیچ fallbackای
به Plan یا Catalog فعلی ندارد. Provider/API/Region/Plan/Image/
Network/Security/Access ناقص یا ناسازگار پیش از هر Create به Manual Review
می‌رود. Adapter Worker همان `CloudProviderAdapter` چندارائه‌دهنده است؛
Mutation Gate پیش‌فرض بسته است و فقط در Dispatch واقعی بررسی می‌شود.
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

تست Integration مهاجرت عمداً به PostgreSQL واقعی نیاز دارد:

```text
POSTGRES_TEST_DATABASE_URL=postgresql://... npm run test:postgres
```

این تست در Schema موقت، Migrationها را مرحله‌ای Deploy می‌کند، ثابت می‌کند
Markup قدیمی `2500 + 0` باقی می‌ماند، Quote/Order معتبر Legacy را هم‌تراز و
قابل پرداخت نگه می‌دارد، Quote ناقص/منقضی/بدون Order را Recoverable و
غیرقابل پرداخت می‌کند، Paid Order/Ledger/Snapshot را ثابت نگه می‌دارد،
اجرای دوباره را Idempotent می‌سنجد و رقابت واقعی دو Transition را از
State Service اجرا می‌کند. نبود این متغیر خطاست و به
عنوان Pass یا Skip گزارش نمی‌شود.

Migration `20260730190000_provider_review_hardening` نیز Forward-only است و
Revisionهای جریان، Lease/Freshness کاتالوگ، Snapshot تنظیم تحویل و جدول‌های
Health Check/Secure Delivery را اضافه می‌کند. Stateهای Legacy مبهم به آخرین
مرحلهٔ قابل اثبات عقب برده می‌شوند. Remediation با
`ProductFlowTransition`های دارای Idempotency Key قابل Audit است. Quote معتبر
فقط وقتی `AWAITING_PAYMENT` می‌ماند که تمام Lockهای Provider/Delivery و
Snapshot مالی کامل باشند؛ در غیر این صورت Quote Invalid/Expired، Order
`DRAFT` و Session `REQUIREMENTS_COMPLETE` می‌شود تا Customer تنظیم تحویل و
Quote تازه بگیرد. مبلغ، Ledger، Paid status و Snapshot مالی Paid Order
بازنویسی نمی‌شوند.

Migration `20260730223000_provider_review_recovery_v2` اصلاح Review دوم و
Forward-only است:

- Quoteها را در سطح کل Graph هر Session ارزیابی می‌کند، نه به‌صورت ردیفی؛
- یک Quote قطعی منتخب را با ترتیب پایدار انتخاب می‌کند و siblingهای
  `ECONOMY/GROWTH` را بدون عقب‌بردن Graph معتبر Invalid می‌کند؛
- Graph ناقص را فقط یک‌بار به آخرین State قابل اثبات برمی‌گرداند و Transition
  Audit یکتا ثبت می‌کند؛
- Session، ServiceOrder و InfrastructureOrder پرداخت‌شده را حتی با Revision
  برابر ولی State ناسازگار هم‌تراز می‌کند؛
- Amount، Ledger، `paidAt`، Quote financial snapshot، Plan snapshot و
  Provider selection snapshot پرداخت‌شده را تغییر نمی‌دهد؛
- ستون‌های Idempotency مسیر Catalog، زمان/Metadata Job و Capability Health
  را افزایشی اضافه و Backfill می‌کند.

Integration Test این Migration روی PostgreSQL واقعی، Graphهای چند Quote،
Graph ناقص، Paid State ناسازگار، ثبات مالی/Provider، رقابت Transition،
Health آروان و ParsPack، Retry هم‌زمان، جلوگیری از Create تکراری و رسیدن به
Manual Review پس از سه تلاش را پوشش می‌دهد. اجرای دوم `prisma migrate deploy`
فقط no-op بودن سازوکار Deployment Prisma را ثابت می‌کند؛ ادعای اجرای دوبارهٔ
SQL یک Migration ثبت‌شده نیست.

Migration `20260730234500_terminal_order_recovery` سومین اصلاح Forward-only
است و دو Migration قبلی را بازنویسی نمی‌کند:

- ServiceOrder بازگشت‌وجه‌شده را فقط با Refund Ledger تکمیل‌شده‌ای بازیابی
  می‌کند که از طریق `reversedEntryId` دقیقاً Debit تکمیل‌شده
  `SERVICE_PURCHASE` همان Order را معکوس کرده باشد؛
- `CANCELED` فقط با InfrastructureOrder صریحاً `CANCELED` بازیابی می‌شود و
  برای رکورد فاقد شاهد هیچ Mapping حدسی انجام نمی‌شود؛
- State و Revision Ownerهای موجود را به `CANCELLED` هم‌تراز می‌کند، بدون
  تغییر Wallet، Ledger، Amount، `paidAt` یا Snapshot مالی/Provider؛
- Trigger دیتابیس اجازه نمی‌دهد `PAID` به چیزی جز `REFUNDED` برود و
  `REFUNDED/CANCELED` از وضعیت Terminal خارج شوند؛
- تست PostgreSQL وضعیت مالی را قبل و بعد مقداربه‌مقدار مقایسه و Rollback
  Runtime Refund، Conflictهای Idempotency و مسیر خروج Manual Review را روی
  دیتابیس واقعی اجرا می‌کند.
