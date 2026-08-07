# Commercial Pricing v3 — موتور واحد قیمت‌گذاری

این سند مرجع Task 1 از بازسازی تجاری AbrChin است: یک موتور واحد، Margin-محور،
اتمیک و نسخه‌دار برای همه سطوح قیمت.

## فرمول Canonical

فقط یک پیاده‌سازی وجود دارد: `computeCommercialPriceBreakdown` در
`lib/pricing/commercial-engine.ts`.

```text
هزینه Provider (ماهانه)
+ Markup منبع            (ceil(bps))
+ Markup نوع محصول        (ceil(bps) — جمع با منبع، نه جایگزین)
+ پرچین (ماهانه)
+ Add-on
× مدت (۱/۳/۶/۱۲ ماه)
− تخفیف دوره ۰/۵/۱۰/۲۰٪ یا کد تخفیف (جایگزین، نه جمع)
+ مالیات VAT روی مبلغ پس از تخفیف
= مبلغ نهایی مشتری
```

- همه مبالغ `BigInt` ریال؛ Float ممنوع.
- سیاست Round یکتا: `ceil(amount × bps / 10000)` در `multiplyBpsRoundUp`.
- Renewal همیشه «یک ماه pretax + مالیات» بدون تخفیف دوره است.
- تفکیک سود منبع/محصول از جمع ceil مشترک مشتق می‌شود تا جمع دو جزء دقیقاً
  برابر کل بماند (سازگار با Snapshotهای تاریخی).

مصرف‌کننده‌ها (همه از همین موتور):

| سطح | مسیر |
|---|---|
| کارت Storefront | `lib/storefront/assortment-service.ts` → `resolveCatalogItemPricing` (term=1) → `priced.finalPriceRial` |
| Quote | `lib/recommendation/quote-service.ts` → `resolvePlanPricing` |
| Checkout / پرداخت | `lib/orders/service.ts`، `lib/orders/pay-order-tx.ts` |
| Renewal | `lib/subscriptions/service.ts` |
| Admin Simulator | `POST /api/admin/finance/preview` (موتور واقعی سرور) |
| Preview اثر تغییر | همان API با `includeImpact` |
| تست‌ها | `scripts/commercial-pricing-test.mts` |

`calculateQuotePricing` در `lib/pricing/quote-line-items.ts` فقط Adapter نازک
روی موتور است تا Call siteها و Snapshotهای قبلی دست‌نخورده بمانند.

## Margin در برابر Markup

```text
Gross margin = سود ÷ قیمت فروش زیرساخت
Markup       = سود ÷ هزینه خرید
margin = markup / (1 + markup)
markup = margin / (1 − margin)
```

توابع استاندارد (تست‌شده، Client-safe):

- `grossMarginBpsToMarkupBps()` — ورودی صحیح `[0, 10000)`؛ ۱۰۰٪ رد می‌شود.
- `markupBpsToGrossMarginBps()`

پیش‌فرض‌های جدید Launch:

```text
DEFAULT_TARGET_GROSS_MARGIN_BPS = 3000   (30%)
DEFAULT_LAUNCH_MARKUP_BASIS_POINTS = 4286 (≈42.86%)
LEGACY_LAUNCH_MARKUP_BASIS_POINTS = 23333 (فقط برای شناسایی Migration)
```

ورودی اصلی Admin در مرکز مالی «حاشیه سود هدف» است؛ Markup معادل Read-only
نمایش داده می‌شود. مقدار Canonical ذخیره‌شده در DB همچنان
`markupBasisPoints` است.

## Migration از Legacy

`prisma/migrations/20260806200000_commercial_pricing_v3/migration.sql`
(Forward-only و Additive):

1. جدول `FinanceConfigurationRevision` (append-only).
2. `ProviderPricingConfig.markupBasisPoints` پیش‌فرض جدید `4286`.
3. Repair فقط ردیف‌های دقیقاً `23333` → `4286`. مقادیر Custom دست نمی‌خورند.
4. Quote/Order/Renewal های قبلی Snapshot خود را نگه می‌دارند؛ هیچ چیز
   Retroactive نیست.

Product Markup پیش‌فرض صفر می‌ماند (فقط Markup منبع مالک حاشیه ۳۰٪ است).

## API Preview

```text
POST /api/admin/finance/preview
{
  candidate: { providers[targetGrossMarginBps,enabled], productMarkups[],
               taxBps, parchin[], compassServicePrices, lifecycle, priceDisplay },
  simulator?: { providerMonthlyCostRial, provider, productKind,
                termMonths, parchinLevel, couponDiscountBps? },
  includeImpact?: boolean
}
```

- Breakdown کامل از موتور Production برمی‌گردد (UI هیچ فرمولی ندارد).
- `includeImpact` اثر Candidate را روی حداکثر ۲۴ پلن واقعی منتشرشده
  محاسبه می‌کند: تعداد گران/ارزان/بدون تغییر، بیشترین افزایش/کاهش،
  پلن‌های غیرقابل‌فروش با تنظیمات جدید، و نتیجه Parity.
- Margin خارج از بازه با 400 رد می‌شود؛ سطح Guardrail (`ok/warn/confirm`)
  همیشه برمی‌گردد.

## API Publish (اتمیک و نسخه‌دار)

```text
GET   /api/admin/finance/configuration   ← تنظیمات فعلی + ۲۰ نسخه اخیر
PATCH /api/admin/finance/configuration   ← انتشار اتمیک یا Rollback
```

انتشار در یک `prisma.$transaction`: Provider pricing، Product pricing،
Commerce (مالیات/چرخه/قطب‌نما)، پرچین، تنظیمات نمایش قیمت
(`StorefrontAssortmentSettings`) و سپس ایجاد
`FinanceConfigurationRevision` با Actor، زمان، دلیل و Snapshot کامل.
شکست هر بخش یعنی Rollback همه چیز و بدون Revision.

Rollback:

```json
{ "rollbackToRevisionId": "…", "reason": "اختیاری" }
```

Snapshot نسخه قدیمی به‌عنوان یک نسخه جدید (با `rollbackOfId`) منتشر می‌شود؛
تاریخچه append-only است و سفارش‌های قبلی تغییری نمی‌کنند.

سرویس‌ها: `lib/admin/finance-configuration.ts`
(`applyFinanceConfiguration`, `rollbackFinanceConfiguration`,
`previewFinanceImpact`, `checkCardQuoteParity`, `readFinanceConfiguration`).

Endpointهای قدیمی (`/api/admin/infrastructure/pricing`,
`/api/admin/infrastructure/providers/markup`) برای سازگاری باقی‌اند اما مرکز
مالی فقط از مسیر اتمیک استفاده می‌کند.

## Guardrailهای مالی

- Margin `< 0` یا `≥ 100%` → رد (400).
- `≥ 50%` → هشدار واضح در UI و Preview.
- `≥ 70%` → تأیید تایپی الزامی: عبارت دقیق «تایید حاشیه بالا»
  (`HIGH_MARGIN_CONFIRMATION_PHRASE`؛ در Rollback لازم نیست چون قبلاً
  منتشر شده بود).
- قبل از انتشار، اثر روی پلن‌های واقعی (تا ۲۴ نمونه، حداقل ۱۰ در صورت وجود)
  با بیشترین افزایش/کاهش و تعداد متاثر نمایش داده می‌شود.
- اگر Card و Quote یک‌ماهه برابر نباشند، Publish با 409
  (`card_quote_parity_failed`) متوقف می‌شود.
- Provider/Product غیرفعال در Preview به‌عنوان «غیرقابل‌فروش» شمارش می‌شود و
  کارت آن هرگز purchasable نیست.

## نمایش قیمت

- قیمت اصلی کارت = مبلغ نهایی یک‌ماهه همان پلن (شامل Markup، پرچین سطح
  Minimum پلن و VAT) — دقیقاً برابر مبلغ Quote یک‌ماهه.
- Round نمایشی ۵۰۰تومانی حذف شد؛ `formatStorefrontToman` همان تبدیل دقیق
  ریال→تومان صفحه Quote است (`displayTomanFromRial`).
- ساعتی/روزانه «معادل مصرف» است: `ceil(final/720)` و `ceil(final/30)` از
  `deriveUsageEquivalentPrices` — مدل پرداخت نیست و در UI با برچسب «معادل»
  نمایش داده می‌شود.
- عنوان، فهرست خدمات و مبلغ Dialog پرچین باید همان سطح صورتحساب‌شده
  (Minimum پلن / شروع) باشد؛ برندینگ سطح بالاتر روی کارتی که START شارژ
  می‌شود ممنوع است.
- CTA «ثبت سفارش» و Style آن دست‌نخورده ماند.

## تست‌ها

- `scripts/commercial-pricing-test.mts` (داخل `test:infrastructure`):
  تبدیل Margin/Markup و پیش‌فرض ۳۰٪، محتوای Repair دقیق Legacy، جمع
  Markup منبع+محصول، پرچین، مالیات، تخفیف ۱/۳/۶/۱۲، جایگزینی Coupon،
  برابری Card/Quote، Renewal، Immutability خروجی موتور، برابری Adapter،
  Guardrailها، معادل‌های مصرف.
- `scripts/finance-configuration-postgres-test.mts`
  (`test:finance-config`؛ در `test:financial-postgres` و
  `test:finance-config-isolated`): انتشار اتمیک + Revision،
  Rollback تراکنشی هنگام شکست میانی، الزام تأیید حاشیه بالا،
  Rollback نسخه‌ها با تاریخچه append-only، و Replay دقیق Repair Legacy
  (فقط 23333؛ Custom 25000 دست‌نخورده؛ Default ردیف جدید 4286).
- `test:fresh-migration` و `test:migration-upgrade` سازگاری Migration تازه
  و Upgrade را با PostgreSQL ایزوله (Docker) پوشش می‌دهند.

## نکات Task شماره ۲ (انجام‌شده روی همین Branch)

- Dominated Plan Detection در `lib/storefront/dominance.ts` و کاتالوگ عمومی.
- چینش نو/استوار/کهکشان فقط با vCPU+RAM؛ Disk از شرط Tier حذف شد.
- قرارداد نسخه‌دار پرچین در `lib/parchin/service-contract.ts` با Snapshot روی
  Quote/Order (`parchinServiceSnapshot`).
- Migration:
  `prisma/migrations/20260806210000_storefront_dominance_parchin_v3`.
- تست: `scripts/storefront-dominance-parchin-test.mts` داخل
  `test:recommendation`.

## نکات Task شماره ۳

- Endpointهای Legacy قیمت (`/api/admin/infrastructure/pricing` و
  `providers/markup`) بازنشسته شده‌اند و با HTTP 410 به مسیر اتمیک
  `/api/admin/finance/configuration` هدایت می‌شوند؛ نوشتن مستقل دیگر ممکن نیست.
- PAYG (`lib/billing/activation.ts`) هنوز Estimate ساعتی مستقل دارد و از
  مسیر خرید Prepaid فروشگاه عمومی جدا است.
- Impact preview روی ۲۴ پلن آخر نمونه‌گیری می‌کند؛ در صورت رشد کاتالوگ،
  صفحه‌بندی/انتخاب هوشمند نمونه را اضافه کنید.
- Finance Center UI هنوز ویرایش کامل فهرست خدمات پرچین را ساده نگه داشته؛
  Publish سمت سرور فهرست زنده را Merge می‌کند تا Snapshot کامل بماند و
  Version فقط با تغییر واقعی قرارداد بالا برود.


## Dominated Plan Detection (Task 2)

در یک بازار قابل‌مقایسه (لوکیشن مشتری‌محور، Product kind، Delivery mode،
صفات تجاری ثبت‌شده مانند ترافیک/نوع Disk/IPv4/IPv6 وقتی معتبرند):

```text
A مغلوب می‌کند B را اگر
A.vCPU >= B.vCPU و A.RAM >= B.RAM و A.Disk >= B.Disk
و A.finalMonthlyPrice <= B.finalMonthlyPrice
و حداقل یکی Strictly better باشد.
```

- قیمت = `finalPriceRial` موتور تجاری Task 1 (نه Provider cost).
- منبع ناقص مغلوب نمی‌کند.
- بین Equals: ارزان‌ترین سپس تازه‌ترین قابل‌خرید می‌ماند.
- Provider به‌تنهایی پلن ضعیف را حفظ نمی‌کند.
- همه Non-dominated نمایش داده می‌شوند؛ ترتیب: قیمت، RAM، CPU، Disk.
- Diagnostics در Admin Storefront بدون افشای Provider به مشتری.

## Chinish Tiers بدون Disk

```text
نو: زیر حداقل استوار
استوار: vCPU >= 6 و RAM >= 12GB (قابل تنظیم Admin)
کهکشان: vCPU >= 16 و RAM >= 32GB (قابل تنظیم Admin)
```

Disk فقط مشخصه/فیلتر است. متن مشتری عبارت‌های داخلی آستانه را نشان نمی‌دهد.

## قرارداد پرچین نسخه‌دار

سه سطح Start / Active / Stable با `version`، `includedServices`،
`excludedServices`، `serviceLimits`، `supportWindow`، `firstResponseTarget`.
Snapshot روی Quote و ServiceOrder؛ Publish Admin نسخه را بالا می‌برد و سفارش
قبلی را عوض نمی‌کند. Line Item عنوان + نسخه را ثبت می‌کند.

## منحنی سود سرورها (Task 3)

AbrChin روی سرورهای ارزان حاشیهٔ بالاتر و روی سرورهای گران حاشیهٔ پایین‌تر
می‌گیرد. منحنی فقط **Markup منبع** را برای فروش‌های عادی
`CLOUD_SERVER` / `READY_INSTANT_SERVER` / `API_CATALOG` Resolve می‌کند و به
همان موتور واحد `computeCommercialPriceBreakdown` می‌دهد. Markup محصول/SKU
جدا و صریح می‌ماند؛ جمع دوباره با Markup قدیمی منبع ممنوع است.

### پنج بازهٔ هدف (برچسب کسب‌وکار — هزینه ماهانه Provider)

| هزینه Provider (تومان) | حاشیه سود هدف |
|---|---:|
| تا ۵ میلیون | ۷۰٪ |
| ۵ تا ۱۰ میلیون | ۶۰٪ |
| ۱۰ تا ۱۵ میلیون | ۵۰٪ |
| ۱۵ تا ۲۵ میلیون | ۴۰٪ |
| ۲۵ میلیون به بالا | ۳۰٪ |

DB داخلی ریال است (`×۱۰`).

### Target در برابر Effective

در مرزهای نزولی، انتقال **ریاضی** محاسبه می‌شود (عرض ثابت hardcode نیست):

```text
boundarySale = B / (1 − M1)
transitionEnd = B × (1 − M2) / (1 − M1)
```

برای `B ≤ cost < transitionEnd` قیمت فروش زیرساخت روی `boundarySale` نگه
داشته می‌شود تا هیچ سرور گران‌تری صرفاً به‌خاطر عبور از مرز ارزان‌تر نشود.
حاشیهٔ مؤثر در این بازه از M1 به M2 به‌صورت خطی با هزینه کاهش می‌یابد.

با پیش‌فرض‌ها تقریباً:

```text
5M–6.667M   : 70% → 60%
10M–12.5M   : 60% → 50%
15M–18M     : 50% → 40%
25M–29.167M : 40% → 30%
```

Resolver خالص: `lib/pricing/profit-curve.ts` → `resolveProfitCurve`.
در Transition، موتور با `infrastructureSaleRialOverride` فروش دقیق ثابت را
حفظ می‌کند.

### کف حاشیه پس از تخفیف

`minimumPostDiscountGrossMarginBps` پیش‌فرض `2000` (۲۰٪). تخفیف درخواستی،
حداکثر مجاز و تخفیف اعمال‌شده Snapshot می‌شوند. اگر Coupon کپ شود، Quote
صریحاً «تخفیف حداکثر قابل اعمال» را نشان می‌دهد.

### Revision / Rollback

منحنی داخل همان `FinanceConfigurationRevision.snapshot.profitCurve` است.
Publish/Rollback اتمیک با بقیهٔ مرکز مالی؛ جداگانه سیستم Finance دوم ساخته
نشد. Migration:
`prisma/migrations/20260807010000_profit_curve_operational_accounting`.

### Order Snapshot

`commercialEconomicsSnapshot` روی Quote/Order: revision، باند، target/effective
margin، markup منبع/محصول، هزینه Provider، وضعیت Transition.

### Dominance

پس از انتشار منحنی، Dominance همچنان از `finalPriceRial` موتور تجاری
(با Markup مشتق‌شده از منحنی) استفاده می‌کند — فرمول جدا ندارد.
Preview مرکز مالی تعداد پلن‌های تازه‌مغلوب/تازه‌نمایان را نشان می‌دهد بدون
Mutation روی Storefront.
