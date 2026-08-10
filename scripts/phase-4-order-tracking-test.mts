import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(path, "utf8");

test("order detail always exposes a state-based next action and explicit refresh", async () => {
  const [page, refresh] = await Promise.all([
    source("app/account/orders/[id]/page.tsx"),
    source("components/account/order-status-refresh.tsx"),
  ]);
  assert.match(page, /SectionCard title="اقدام بعدی"/);
  assert.match(page, /پرداخت را تکمیل کنید/);
  assert.match(page, /تأیید ساخت توسط ابرچین/);
  assert.match(page, /تأیید نهایی تحویل/);
  assert.match(page, /دریافت اطلاعات دسترسی و مدیریت سرویس/);
  assert.match(refresh, /router\.refresh\(\)/);
  assert.match(refresh, /aria-live="polite"/);
  assert.doesNotMatch(refresh, /setInterval|window\.location\.reload/);
});

test("pre-delivery cancellation is a truthful, owned support workflow", async () => {
  const [orderPage, supportPage, form, supportService] = await Promise.all([
    source("app/account/orders/[id]/page.tsx"),
    source("app/account/support/requests/new/page.tsx"),
    source("components/account/support-request-create-form.tsx"),
    source("lib/support/service.ts"),
  ]);
  assert.match(orderPage, /intent=cancel-before-delivery/);
  assert.match(orderPage, /بازگشت اعتبار فقط پس از تأیید امن/);
  assert.match(supportPage, /درخواست لغو پیش از تحویل/);
  assert.match(supportPage, /initialCategory=.*"CHANGE"/s);
  assert.match(form, /initialSubject/);
  assert.match(form, /initialDescription/);
  assert.match(
    supportService,
    /where:\s*\{\s*id:\s*input\.serviceOrderId,\s*userId:\s*input\.userId\s*\}/,
  );
});

test("order tracking reads are dynamic but contain no business mutation", async () => {
  const page = await source("app/account/orders/[id]/page.tsx");
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /productFlowTransition\.findMany/);
  assert.doesNotMatch(
    page,
    /\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/,
  );
});
