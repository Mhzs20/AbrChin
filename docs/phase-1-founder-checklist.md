# Checklist Founder برای پذیرش فاز ۱

> این سند یک مسیر اجرای دستی است، نه مجوز Deploy یا بازکردن Gate. مقادیر Secret
> را در این فایل، Ticket، Log یا Screenshot ثبت نکنید.

## پیش‌نیازهای بیرونی

- [ ] SHA تأییدشدهٔ `main` با Runbook Deploy یکسان است.
- [ ] Environment Production بدون چاپ مقدار Secret کامل شده است: Database,
  Session, Credential encryption, OTP/Kavenegar, Gateway و Provider منتخب.
- [ ] در Admin، Connection Check فقط‌خواندنی Arvan، ParsPack، OTP و Gateway
  نتیجهٔ قابل‌فهم دارد.
- [ ] حداقل یک SKU Published از Source تأییدشده با قیمت/Availability تازه وجود
  دارد.
- [ ] همهٔ Gateهای Sale و Mutation ابتدا `false` هستند.

## یک خرید کنترل‌شده

1. Founder فقط Gate لازم برای همان Source و همان تست را، پس از Deploy صریح، باز
   می‌کند؛ Provider یا محصول دیگری باز نمی‌شود.
2. Customer با OTP واقعی وارد می‌شود، یک Quote ده‌دقیقه‌ای معتبر می‌گیرد و یک
   پرداخت واقعی انجام می‌دهد.
3. Callback فقط Payment و Order را به `Waiting Admin Provision Approval`
   می‌رساند. پیش از تأیید اول هیچ Resource یا Job ساختی نباید وجود داشته باشد.
4. Admin قیمت/Availability/Balance و اختلاف Snapshot را بررسی کرده و یک‌بار
   Provision را تأیید می‌کند.
5. Provider یا Fulfillment دستی دقیقاً یک Resource با Source/Region/Plan/Image
   قفل‌شده ثبت می‌کند. Admin ابتدا Resource، Health و Credential را می‌بیند.
6. Admin در صورت اشکال Hold/Needs Attention را انتخاب می‌کند؛ در صورت تطبیق
   کامل، یک‌بار Delivery را تأیید می‌کند.
7. فقط پس از تأیید دوم، Customer اطلاعات غیرحساس سرویس را می‌بیند و Credential
   یک‌بار Reveal می‌شود.
8. Payment، دو Admin command، Attempt/Resource و Delivery/Refund احتمالی در
   Audit بررسی می‌شوند؛ هیچ Secret یا Raw Provider response در آن‌ها نیست.

## نتیجه

- [ ] خرید واقعی کامل شد.
- [ ] Resource تکراری ایجاد نشد.
- [ ] Gateهای بازشده و Provider/Product آزمایش‌شده ثبت شدند، بدون Secret.
- [ ] اگر آزمون ناموفق بود: Order در Needs Attention با Retry/Reconcile/Hold یا
  Refund داخلی Audit‌شده قرار گرفت؛ هیچ Refund بانکی خودکار ادعا نشد.
- [ ] فقط پس از تأیید جداگانهٔ Founder دربارهٔ همان Source، فروش عمومی تصمیم‌گیری
  می‌شود.
