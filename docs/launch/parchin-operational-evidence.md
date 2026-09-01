# Parchin operational evidence

وضعیت محصول برای فروش عمومی پرچین: **fail-closed**.

پرچین از Gate سراسری جداگانه در env استفاده نمی‌کند. فروش سطح فقط وقتی مجاز است که
ردیف `ParchinPricingConfig` هم `active = true` باشد و هم
`operationalEvidenceApprovedAt` پر شده باشد. قطع پایگاه‌داده یا نبود شواهد یعنی
**ناموجود**، نه فعال با قیمت صفر.

ادعاهای SLA (پاسخ ۲۴/۷، پایش پنج‌دقیقه‌ای، بکاپ روزانه مدیریت‌شده، آزمون Restore
ماهانه) فقط روی سطح قابل‌فروش نمایش داده می‌شوند.

## منبع‌های ماشینی

| مسئولیت | منبع |
| --- | --- |
| قرارداد الگو | `lib/parchin/service-contract.ts` |
| فروش‌پذیری و شواهد | `lib/parchin/sellable.ts` و ستون `operationalEvidenceApprovedAt` |
| نمایش عمومی fail-closed | `lib/parchin/availability.ts` |
| تقویم پاسخ و الگوی کار | `lib/parchin/operations.ts` |
| قرارداد فعال هر سرور | `ParchinEnrollment` |

## فعال‌سازی شواهد (فقط پس از مدارک واقعی مالک)

```sql
UPDATE "ParchinPricingConfig"
SET "operationalEvidenceApprovedAt" = NOW(),
    "updatedAt" = NOW()
WHERE "level" = 'PARCHIN_START' -- or ACTIVE / STABLE
  AND "active" = true;
```

بدون این به‌روزرسانی، پرداخت سفارش با آن سطح `quote_unavailable` می‌شود.
تست‌های ایزوله با `ABRCHIN_ISOLATED_TEST=1` از مهر شواهد می‌گذرند؛ پروداکشن این متغیر را ندارد.

## کنترل عرضه

فروش سرور همچنان با `PUBLIC_SALE_ENABLED` و Gate منبع/Provider کنترل می‌شود.
خاموش بودن Provider mutation با Fulfillment انسانی سازگار است.
