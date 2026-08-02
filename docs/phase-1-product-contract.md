# قرارداد محصول فاز ۱ ابرچین

> وضعیت: **LOCKED**
>
> تاریخ قفل: ۲۰۲۶-۰۸-۰۲
>
> مرجع تصمیم: این سند Source of Truth محصول فاز ۱ است. تغییر Scope، جریان پول، Provision یا تحویل فقط با دستور صریح Founder مجاز است.

## ۱. هدف فاز ۱

ابرچین در فاز ۱ یک لایه فروش و عملیات کنترل‌شده برای سرور ابری است:

- Catalog و قیمت سرورها را از آروان و پارس‌پک دریافت می‌کند.
- Admin از میان Offerهای Provider، SKU قابل‌فروش ابرچین می‌سازد و منتشر می‌کند.
- ابرچین درصد سود را به قیمت Provider اضافه می‌کند و Quote شفاف می‌سازد.
- مشتری در ابرچین وارد می‌شود، SKU را انتخاب می‌کند و مبلغ سفارش را می‌پردازد.
- پرداخت مشتری هرگز مستقیماً سرور نمی‌سازد.
- Admin یک بار ساخت/تخصیص سرور و یک بار تحویل اطلاعات به مشتری را تأیید می‌کند.
- موجودی متعلق به خود ابرچین نیز باید از همان مدل SKU و Order پشتیبانی شود، ولی Launch فاز ۱ به داشتن موجودی شخصی وابسته نیست.

معیار موفقیت فاز ۱ «اولین فروش واقعی و تحویل کنترل‌شده» است، نه تکمیل همه قابلیت‌های Hosting.

## ۲. مدل کسب‌وکار قطعی

### منابع تأمین

| Source | وضعیت فاز ۱ | نحوه تأمین |
|---|---|---|
| Arvan | اصلی و الزامی | Catalog/Price از API؛ Provision پس از تأیید Admin در صورت پشتیبانی API |
| ParsPack | اصلی و الزامی | Catalog/Price از API؛ Provision پس از تأیید Admin در صورت پشتیبانی API |
| AbrChin Inventory | قابل پشتیبانی | SKU و موجودی دستی برای سرورهایی که بعداً متعلق به ابرچین هستند |

قواعد:

- آروان و پارس‌پک منابع اصلی فروش فعلی هستند؛ ابرچین در حال حاضر برای Launch به سرور شخصی متکی نیست.
- هیچ Offer خام Provider خودکار در فروشگاه منتشر نمی‌شود.
- هر SKU منتشرشده در فاز ۱ یک Source مشخص و قابل ردیابی دارد.
- نام Provider می‌تواند در UI مشتری مخفی بماند، اما Admin و Snapshot سفارش باید Source واقعی را بدانند.
- تغییر Source یک سفارش پرداخت‌شده خودکار نیست و نیازمند تصمیم Admin است.
- ابرچین کیف پول Provider را خودکار شارژ نمی‌کند.

### نقش‌ها

- **Customer:** مشاهده SKU، دریافت Quote، پرداخت، پیگیری سفارش و دریافت Credential پس از تحویل.
- **Admin:** اتصال Provider، Sync، ساخت/انتشار SKU، تنظیم Markup، بررسی پرداخت، تأیید Provision، بررسی سرور ساخته‌شده و تأیید Delivery.
- **Provider:** منبع Catalog، Price و در صورت امکان Provision؛ Provider نقش کاربری داخل ابرچین ندارد.

## ۳. مدل SKU

جریان داده:

Provider Catalog Item → AbrChin SKU → Quote Snapshot → Paid Order → Fulfillment

هر SKU فاز ۱ حداقل شامل این داده‌ها است:

- Source: Arvan، ParsPack یا AbrChin Inventory
- Provider Item/Plan ID یا Inventory Item ID
- عنوان قابل‌فهم برای مشتری
- vCPU، RAM، Disk، Region و سیستم‌عامل‌های مجاز
- قیمت خرید فعلی و واحد پول Source
- درصد Markup
- قیمت فروش نهایی و قیمت تمدید
- زمان تقریبی تحویل
- وضعیت Draft / Published / Paused / Archived
- وضعیت موجودی و زمان آخرین Sync/Verification

قواعد قیمت:

- قیمت Source از Catalog یا داده معتبر Source می‌آید؛ Admin قیمت خام Provider را جعل نمی‌کند.
- Admin درصد Markup را تعیین می‌کند؛ Default می‌تواند در سطح Provider باشد و در صورت نیاز SKU Override داشته باشد.
- همه محاسبات پولی Integer و بدون Floating Point هستند.
- Quote مشتری Snapshot کامل قیمت، Source، SKU و زمان انقضا دارد.
- Quote پیش‌فرض ۱۰ دقیقه معتبر است.
- پس از پرداخت، مبلغ پرداخت‌شده تغییر نمی‌کند.
- پیش از Provision، قیمت و موجودی Provider دوباره بررسی و اختلاف به Admin نشان داده می‌شود؛ اختلاف هرگز Provision خودکار ایجاد نمی‌کند.
- تمدید خودکار در فاز ۱ وجود ندارد.

## ۴. جریان قطعی Customer

۱. مشتری وارد فروشگاه سرور می‌شود.
۲. فقط SKUهای Published، موجود و دارای قیمت معتبر را می‌بیند.
۳. SKU را انتخاب می‌کند و Quote نهایی می‌گیرد.
۴. در صورت نیاز با OTP وارد می‌شود.
۵. مبلغ سفارش را از طریق Payment Gateway ابرچین پرداخت می‌کند.
۶. Callback موفق، پرداخت و سفارش را دقیقاً یک بار ثبت می‌کند.
۷. مشتری صفحه پیگیری سفارش با وضعیت «منتظر تأیید ساخت» را می‌بیند.
۸. تا تأیید دوم Admin هیچ IP، Username یا Password به مشتری نمایش داده یا ارسال نمی‌شود.
۹. پس از تأیید Delivery، مشتری اطلاعات سرویس را در پنل خود دریافت می‌کند.

کیف پول داخلی می‌تواند برای Ledger و Accounting باقی بماند، اما نباید Customer را پس از Callback موفق مجبور به کلیک یا پرداخت دوم کند.

## ۵. State Machine قطعی Order

نام Statusهای داخلی می‌تواند میان ServiceOrder و InfrastructureOrder تقسیم شود، اما UI و رفتار محصول باید دقیقاً این مراحل را منعکس کند:

| مرحله محصول | Actor | نتیجه |
|---|---|---|
| Draft | Customer | Quote یا Checkout ساخته شده است |
| Pending Payment | Customer / Gateway | سفارش منتظر پرداخت است |
| Paid — Waiting Admin Provision Approval | System | پرداخت تأیید شده؛ هیچ Provision اجرا نمی‌شود |
| Provision Approved | Admin | Admin موجودی/کیف پول Provider را بررسی و ساخت را تأیید کرده است |
| Provisioning | System / Admin | درخواست ساخت خودکار ارسال شده یا Fulfillment دستی در جریان است |
| Waiting Admin Delivery Approval | System | سرور ساخته/تخصیص داده شده؛ اطلاعات فقط برای Admin قابل مشاهده است |
| Delivered | Admin | Admin تحویل را تأیید کرده؛ Customer به سرویس دسترسی دارد |
| Needs Attention | Admin | قیمت، موجودی، موجودی کیف پول، API یا تطبیق Resource مشکل دارد |
| Canceled / Refund Pending / Refunded | Admin / System | مسیر لغو یا بازپرداخت با Audit کامل |

Transition ممنوع:

- Paid → Provisioning بدون اولین تأیید Admin
- Provisioning → Delivered بدون دومین تأیید Admin
- Delivered → Credential exposure مجدد بدون سیاست امن
- Retry → ساخت Resource دوم برای همان Order

## ۶. تأیید اول Admin: Provision

صفحه Order پرداخت‌شده باید قبل از تأیید این موارد را نشان دهد:

- مشتری، مبلغ پرداختی، زمان پرداخت و Reference پرداخت
- SKU، مشخصات سرور و Source
- قیمت خرید Snapshot و قیمت خرید فعلی Provider
- Markup و Margin مورد انتظار
- Availability و Freshness آخرین Catalog
- موجودی کیف پول Provider در صورت وجود API معتبر
- اگر Balance API وجود ندارد: وضعیت «نیازمند بررسی دستی» و لینک/راهنمای ورود به Provider
- هر اختلاف قیمت، موجودی یا مشخصات از زمان Quote
- دکمه «تأیید و ساخت/تخصیص سرور»

رفتار دکمه:

- فقط Admin مجاز است.
- درخواست دارای Idempotency Key قطعی بر اساس Order است.
- کلیک مجدد یا Retry Worker نباید Resource دوم بسازد.
- اگر Provider Write API دارد، Provision فقط بعد از این تأیید اجرا می‌شود.
- اگر Provider Write API ندارد یا موقتاً قابل استفاده نیست، Order وارد Fulfillment دستی می‌شود و Admin پس از ساخت در Provider، Resource ID و اطلاعات لازم را ثبت می‌کند.
- برای AbrChin Inventory، این تأیید یک Inventory Item موجود را Reserve/Assign می‌کند.

## ۷. تأیید دوم Admin: Delivery

پس از Provision یا تخصیص موفق، Admin باید این موارد را ببیند:

- Provider و Provider Resource ID
- IP، Region، Plan/Flavor، Image/OS و وضعیت روشن‌بودن
- Username و Credential محافظت‌شده
- نتیجه تطبیق Resource ساخته‌شده با SKU سفارش
- خطا یا هشدار Health/Connectivity در صورت وجود
- دکمه «نگه‌داشتن برای بررسی»
- دکمه «تأیید و ارسال به مشتری»

تا قبل از تأیید دوم:

- Credential فقط در محدوده Admin و به‌صورت محافظت‌شده قابل مشاهده است.
- هیچ SMS، پنل Customer یا Notification نباید Secret را افشا کند.
- وضعیت Customer «در حال آماده‌سازی» باقی می‌ماند.

پس از تأیید دوم:

- وضعیت Order و Service به Delivered/Active می‌رود.
- Credential با سازوکار امن در پنل Customer نمایش داده می‌شود.
- اعلان فاقد Password می‌تواند برای Customer ارسال شود.
- زمان، Actor و نتیجه Delivery در Audit Log ثبت می‌شود.

## ۸. Admin فاز ۱

Admin باید یک ابزار عملیات فروش قابل‌فهم باشد، نه مجموعه‌ای از صفحه‌های فنی پراکنده.

### Navigation اصلی

۱. **مرکز عملیات:** آمادگی فروش، خطاهای Blocking و کارهای منتظر اقدام
۲. **اتصال سرویس‌ها:** Arvan، ParsPack، Kavenegar و Payment Gateway
۳. **Catalog Providerها:** آخرین Sync، Price، Availability و خطا
۴. **SKUهای ابرچین:** ساخت، Mapping، Markup، Publish/Pause
۵. **سفارش‌ها و تحویل:** Queueهای تأیید Provision، Provisioning، تأیید Delivery و Needs Attention
۶. **پرداخت‌ها و مشتریان:** Payment، Refund، Customer و Audit ضروری
۷. **تنظیمات پیشرفته:** Region، Sync Run، Request ID، Raw Error و ابزار تشخیصی

### Dashboard

Dashboard اصلی فقط این موارد را در اولویت نشان می‌دهد:

- وضعیت اتصال آروان
- وضعیت اتصال پارس‌پک
- وضعیت OTP
- وضعیت Payment Gateway
- تعداد SKU منتشرشده و دارای قیمت معتبر
- تعداد Order منتظر تأیید Provision
- تعداد Order منتظر تأیید Delivery
- Orderهای Needs Attention
- اقدام بعدی واضح برای هر مورد

جزئیاتی مانند Raw Payload، Sync Lease، Request ID و Region Error در صفحه اصلی نمایش داده نمی‌شوند.

### Secretها و Connection Check

- Secretهای Production در Environment امن نگهداری می‌شوند و داخل Git Commit نمی‌شوند.
- Admin فقط وضعیت تنظیم‌شدن Secret را به‌صورت Masked می‌بیند.
- برای هر اتصال دکمه Connection Check واقعی وجود دارد.
- نتیجه Check شامل زمان، موفق/ناموفق و Error قابل‌فهم است؛ Secret یا Header حساس Log نمی‌شود.
- ساخت Secret Manager داخل Admin شرط Launch نیست.

## ۹. Feature List قفل‌شده فاز ۱

### P1-01 — Admin Operations Center

- Navigation ساده مطابق این سند
- Checklist آمادگی فروش
- Action Queue برای Provision Approval، Delivery Approval و Needs Attention
- انتقال جزئیات فنی به Advanced

### P1-02 — Provider Connections

- اتصال واقعی Arvan و ParsPack
- تنظیم Kavenegar و Payment Gateway
- Masked status و Connection Check
- Capability detection برای Catalog، Price، Balance و Provision

### P1-03 — Catalog Sync

- Sync واقعی Catalog و Price هر Provider
- Normalize کردن Plan/Region/Resource
- Freshness، Availability و Error state
- هیچ Auto-publish

### P1-04 — AbrChin SKU Management

- ساخت SKU از Provider Catalog Item
- ساخت SKU برای AbrChin Inventory
- Mapping مشخص Source
- Markup درصدی
- Preview قیمت فروش
- Publish / Pause / Archive
- Inventory count برای منبع خود ابرچین

### P1-05 — Storefront and Quote

- نمایش فقط SKUهای قابل‌فروش
- صفحه مشخصات قابل‌فهم
- Quote ده‌دقیقه‌ای با Snapshot کامل
- CTA واحد برای خرید
- عدم نمایش مسیرهای ناقص یا آزمایشی به Customer

### P1-06 — Auth and Payment

- OTP واقعی
- Payment Gateway واقعی
- Payment Callback امن و Idempotent
- ثبت خودکار Order بعد از پرداخت موفق
- بدون کلیک یا پرداخت دوم Customer

### P1-07 — First Admin Gate

- Order پرداخت‌شده در Queue تأیید Provision
- نمایش قیمت/موجودی/Balance و اختلاف‌ها
- Hold، Cancel/Refund path و Approve Provision
- عدم Provision قبل از تأیید

### P1-08 — Provisioning

- Provision خودکار برای Provider دارای Write API
- Fulfillment دستی کنترل‌شده برای Provider فاقد Write API
- Assign برای AbrChin Inventory
- Idempotency و Reconciliation
- Capture امن Resource ID و Credential

### P1-09 — Second Admin Gate and Delivery

- نمایش سرور ساخته‌شده فقط به Admin
- بررسی Resource و Credential
- Hold یا Approve Delivery
- تحویل امن به Customer پس از تأیید
- Notification بدون Secret

### P1-10 — Customer Panel

- پیگیری Order با Status قابل‌فهم
- مشاهده سرویس فعال
- دریافت Credential با سیاست امن
- تاریخچه Payment و Order ضروری
- Support path واضح

### P1-11 — Failure Recovery and Audit

- Needs Attention بدون ازبین‌رفتن Payment یا Order
- Retry امن و Idempotent
- Audit دو تأیید Admin
- Refund path
- عدم افشای Secret در Log، Error یا Notification

## ۱۰. قواعد حیاتی غیرقابل نقض

- Payment موفق هرگز Trigger مستقیم Provision نیست.
- دو تأیید مستقل Admin برای Provision و Delivery الزامی است.
- هر Order حداکثر یک Resource فعال از یک Provision command دریافت می‌کند.
- Callback، Admin command و Worker retry همگی Idempotent هستند.
- Credential در Database رمزنگاری می‌شود و در Log، Analytics و Notification ثبت نمی‌شود.
- Customer پیش از Delivery Approval به Credential دسترسی ندارد.
- Quote، Payment، Provider Cost و Margin Snapshot قابل Audit هستند.
- تغییر Price یا Availability Provider، Order پرداخت‌شده را حذف یا بی‌اثر نمی‌کند؛ آن را به تصمیم Admin می‌برد.
- خطای Provider نباید پول Customer یا وضعیت Order را گم کند.
- Endpointهای Admin فقط برای Role=ADMIN قابل اجرا هستند.
- Mock Provider، Mock Gateway و داده نمایشی در فروش Production مجاز نیستند.

## ۱۱. خارج از Scope و Launch Gate فاز ۱

این موارد نباید قبل از کامل‌شدن اولین فروش واقعی، مسیر توسعه را منحرف کنند:

- Provision خودکار بلافاصله بعد از Payment
- Delivery خودکار بدون Admin
- شارژ خودکار کیف پول Provider
- Auto-routing هوشمند میان Providerها
- Auto-renew
- Resize، Reboot، Snapshot و Lifecycle کامل Cloud
- چند Currency و چند Payment Gateway هم‌زمان
- AI recommendation پیشرفته و توسعه بیشتر Compass
- Secret Manager قابل ویرایش داخل Admin
- Monitoring و Test infrastructure غیرضروری
- خرید یا راه‌اندازی سخت‌افزار اختصاصی ابرچین

پشتیبانی نرم‌افزاری AbrChin Inventory داخل فاز ۱ است؛ داشتن موجودی واقعی شرط Launch نیست.

## ۱۲. ترتیب اجرای فاز ۱

۱. بازطراحی Admin به Operations Center و اتصال واقعی کلیدها
۲. تثبیت Provider Connections و Capabilityها
۳. Sync Catalog و ساخت SKUهای واقعی
۴. نمایش SKU و Quote در فروشگاه
۵. Payment موفق تا وضعیت Waiting Admin Provision Approval
۶. اولین Admin Gate و Provision/Fulfillment
۷. ثبت Resource و Credential تا Waiting Admin Delivery Approval
۸. دومین Admin Gate و Delivery امن
۹. یک خرید واقعی Founder از ابتدا تا انتها
۱۰. رفع ایرادهای همان خرید و فعال‌سازی فروش عمومی

در هر مرحله، کد موجود باید Reuse و ساده شود؛ بازنویسی بی‌دلیل یا توسعه مسیرهای خارج از این سند ممنوع است.

## ۱۳. Definition of Done فاز ۱

فاز ۱ فقط زمانی تمام است که:

- Arvan و ParsPack در Admin وضعیت اتصال و Catalog واقعی داشته باشند.
- Admin بتواند Offer منتخب را به SKU قیمت‌دار و Published تبدیل کند.
- Customer بتواند SKU واقعی را ببیند، وارد شود و پرداخت واقعی انجام دهد.
- پس از Payment هیچ سروری بدون تأیید Admin ساخته نشود.
- تأیید اول دقیقاً یک Provision/Assign ایجاد کند.
- اطلاعات سرور ساخته‌شده ابتدا فقط برای Admin نمایش داده شود.
- Customer فقط پس از تأیید دوم Credential را دریافت کند.
- Failure و Retry باعث Resource تکراری یا گم‌شدن Payment نشود.
- حداقل یک فروش واقعی از ابتدا تا تحویل با موفقیت انجام شود.

