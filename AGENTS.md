# AGENTS.md — AbrChin

این فایل قواعد دائمی کار روی Repository ابرچین است و برای همه Agentها در کل Repository اعمال می‌شود.

## Product Source of Truth

قبل از هر تغییر محصولی، فایل **docs/phase-1-product-contract.md** را کامل بخوان.

این سند برای فاز ۱ LOCKED است. هیچ Agentی مجاز نیست بدون دستور صریح Founder موارد زیر را تغییر، تفسیر مجدد یا دور بزند:

- مدل تأمین Arvan / ParsPack / AbrChin Inventory
- مدل SKU و Markup
- جریان Customer تا Payment
- تأیید اول Admin برای Provision
- تأیید دوم Admin برای Delivery
- قواعد Idempotency، Credential و Audit
- Feature List و Out of Scope فاز ۱

اگر کد فعلی با قرارداد فاز ۱ تعارض دارد، قرارداد فاز ۱ مقدم است.

## Execution Model

- فقط روی **main** کار کن.
- Branch، Worktree و Pull Request نساز.
- تغییر مرتبط را مستقیم روی main Commit و Push کن.
- GitHub Actions، CI/CD workflow یا Deploy خودکار ایجاد یا اجرا نکن.
- Refactor نامرتبط، معماری نمایشی و فرایند مدیریتی اضافه نکن.
- هر بار نزدیک‌ترین بخش ناقص از مسیر اولین فروش واقعی را کامل کن.
- Deploy Production فقط وقتی انجام می‌شود که Founder صریحاً Deploy را بخواهد.

## Speed and Scope

اولویت پروژه رساندن سریع محصول قابل‌فروش به Production است.

- Scope را به Featureهای خارج از قرارداد گسترش نده.
- Feature ناقص جدید نساز؛ مسیر اصلی فروش را End-to-End کامل کن.
- از کد موجود Reuse کن و فقط پیچیدگی‌ای را اضافه کن که برای رفتار قفل‌شده لازم است.
- Admin باید برای Founder قابل‌فهم باشد؛ Raw diagnostics را به Advanced منتقل کن.
- اصطلاحات فنی لازم را دقیق نگه دار، اما UI باید Action بعدی را واضح نشان دهد.

## Testing

تست نهایی محصول با Founder است. Agent فقط تست‌های حیاتی و مرتبط با تغییر جاری را اجرا می‌کند.

تست حیاتی یعنی بررسی مستقیم یکی از این ریسک‌ها:

- Money و Payment idempotency
- Data loss یا Migration safety
- Admin authorization و Security
- Provision idempotency و جلوگیری از Resource تکراری
- Credential encryption و عدم افشا
- Production startup/availability وقتی تغییر واقعاً آن را تحت تأثیر قرار می‌دهد

قواعد:

- Full test suite، Snapshot test، Visual test و تست‌های نمایشی را اجرا یا اضافه نکن مگر Founder صریحاً بخواهد.
- تست‌های موجود نامرتبط را برای اطمینان عمومی اجرا نکن.
- اگر تغییر فقط Documentation است، تست اجرا نکن.
- پیاده‌سازی باید درست باشد؛ حداقل تست به معنی حداقل کیفیت نیست.

## Risk Handling

اگر خطر واقعی از‌دست‌رفتن داده، پول، امنیت یا Down‌شدن Production دیدی:

- خطر را کوتاه، دقیق و فوری به Founder اعلام کن.
- هشدار را به بروکراسی یا توقف کل کار تبدیل نکن.
- همه بخش‌های امن و مجاز کار را ادامه بده.
- فقط اقدام مشخصی که به‌دلیل نبود دسترسی، مجوز لازم یا ماهیت برگشت‌ناپذیر قابل اجرا نیست، انجام نمی‌شود.

## Money, Orders and Provisioning

- Payment موفق هرگز مستقیماً Provision را اجرا نمی‌کند.
- اولین Admin approval برای Provision الزامی است.
- دومین Admin approval برای Delivery الزامی است.
- Callback، Admin command و Worker retry باید Idempotent باشند.
- یک Order نباید به‌دلیل Retry بیش از یک Resource بسازد.
- Price و Provider state پیش از Provision دوباره بررسی و به Admin نشان داده می‌شود.
- Provider failure نباید Payment یا Order را حذف کند.
- Floating Point برای مبلغ پول ممنوع است.
- Secret و Credential در Log، Error، Analytics یا Notification ممنوع است.
- Customer قبل از Delivery approval به Credential دسترسی ندارد.

## Provider and SKU Rules

- منابع اصلی فعلی Arvan و ParsPack هستند.
- AbrChin Inventory منبع قابل پشتیبانی است، نه پیش‌فرض Launch.
- Catalog Provider هیچ‌وقت Auto-publish نمی‌شود.
- Admin SKU منتخب را می‌سازد/Map می‌کند، Markup را تعیین و سپس Publish می‌کند.
- Secretهای Provider در Environment امن نگهداری می‌شوند و داخل Git Commit نمی‌شوند.
- Admin باید Masked status و Connection Check واقعی داشته باشد.
- اگر Provider Provision API ندارد، Fulfillment دستی باید همان دو Gate ادمین را حفظ کند.

## Completion Report

پس از هر تسک فقط این موارد را گزارش کن:

- چه چیزی پیاده‌سازی شد
- Commit SHA روی main
- کدام تست حیاتی اجرا شد یا چرا تست لازم نبود
- Risk واقعی باقی‌مانده
- Founder دقیقاً چگونه همان Feature را تست کند
- Deploy انجام شده یا نشده

Branch، PR، Worktree، Reviewer state و گزارش تست‌های نامرتبط را وارد خروجی نکن.

## Cursor Cloud specific instructions

Stack: Next.js 16 (Turbopack) + React 19 + Prisma 6 + PostgreSQL 16 monolith on port `3010`, plus a separate Node provisioning/billing worker. Standard dev commands are in `README.md` and `package.json` scripts; only the non-obvious startup caveats are captured here.

- PostgreSQL 16 runs locally on the VM (db `abrchin`, user `abrchin`, password `abrchin`, `127.0.0.1:5432`). It is NOT auto-started on boot — start it with `sudo pg_ctlcluster 16 main start` before running the app, tests, or migrations. Confirm with `sudo pg_lsclusters`.
- A dev `.env` already exists on the VM (gitignored, so it is not in the repo). `DATABASE_URL` points to the local Postgres above, and `ADMIN_MOBILES=09120000000`. If `.env` is missing, recreate it from `.env.example` and set `SESSION_SECRET` (≥16 chars) and a base64 32-byte `CREDENTIAL_ENCRYPTION_KEY`.
- Apply schema after Postgres is up: `npx prisma migrate deploy` (migrations are intentionally NOT part of the startup update script).
- Web dev server: `npm run dev` → `http://localhost:3010`. Liveness is `/api/health`; readiness is `/api/readiness`.
- Worker: there is no npm run script to launch it. Build with `npm run build:worker`, then run `node dist/worker/provisioning-worker.js` with the env loaded (e.g. `set -a; . ./.env; set +a; node dist/worker/provisioning-worker.js`). It has no HTTP port; it heartbeats via the DB and `/api/readiness` reports the worker `degraded/outage` when it is not running.
- Expected dev readiness: `/api/readiness` returns `degraded` with `billingContracts: stale` because provider billing contracts are unverified without real Arvan/ParsPack credentials. This is normal in dev; `web`, `database`, `provisioningWorker`, and `billingCatchUp` should be `healthy`.
- OTP login in dev uses `SMS_PROVIDER=console`, so the login code is printed to the web server console, not sent by SMS. Find it with a `[sms:console]` log line (e.g. `otp=NNNNNN`). Providers/payments default to mock/fail-closed gates, so no external credentials are needed for local dev.
