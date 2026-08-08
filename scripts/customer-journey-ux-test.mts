import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import {
  ParchinLevel,
  PrismaClient,
  SupportRequestCategory,
  SupportRequestPriority,
  SupportRequestStatus,
  UserRole,
} from "@prisma/client";

import { supportPriorityFromParchin } from "../lib/labels/customer.ts";
import {
  createSupportRequest,
  getCustomerSupportRequest,
  listAdminSupportRequests,
} from "../lib/support/service.ts";
import { WalletError } from "../lib/wallet/errors.ts";

const databaseUrl = process.env.DATABASE_URL;
const prisma = databaseUrl
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : null;

after(async () => {
  if (prisma) await prisma.$disconnect();
});

test("prepaid public copy has no PAYG consumption promise", async () => {
  const files = [
    "app/cloud-servers/page.tsx",
    "app/support/page.tsx",
    "app/help/page.tsx",
    "components/faq-list.tsx",
    "components/support-selector.tsx",
    "app/account/page.tsx",
    "app/account/orders/page.tsx",
  ];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /فقط به.?اندازه مصرف/);
    assert.doesNotMatch(source, /PAYG \/ Wallet/);
    assert.doesNotMatch(source, /Cadence|Settlement|Runway/);
  }
  const termUi = await readFile("components/ready-server-quote-button.tsx", "utf8");
  assert.match(termUi, /۳ ماه — ۵٪ تخفیف/);
  assert.match(termUi, /۶ ماه — ۱۰٪ تخفیف/);
  assert.match(termUi, /۱۲ ماه — ۲۰٪ تخفیف/);
});

test("quote pages use Persian product language", async () => {
  const cloud = await readFile("app/cloud-servers/quote/[id]/page.tsx", "utf8");
  const ready = await readFile("app/ready-servers/quote/[id]/page.tsx", "utf8");
  for (const source of [cloud, ready]) {
    assert.match(source, /پیش‌فاکتور|قیمت قفل‌شده/);
    // Customer-visible copy must not say "Snapshot"; internal field names are OK.
    assert.doesNotMatch(source, />\s*Snapshot\s*</);
    assert.doesNotMatch(source, /["'`]Snapshot["'`]/);
    assert.doesNotMatch(source, /Admin/);
    assert.doesNotMatch(source, /تغییر بعدی پرچین در Admin/);
    assert.match(source, /operatingSystem|lockedOsLabel/);
    assert.doesNotMatch(source, /تنظیمات پیشرفته/);
    assert.match(source, /readParchinServiceSnapshot|parchin/);
  }
});

test("robots disallow private surfaces; sitemap is public-only", async () => {
  const robots = await readFile("app/robots.ts", "utf8");
  const sitemap = await readFile("app/sitemap.ts", "utf8");
  assert.match(robots, /\/admin/);
  assert.match(robots, /\/account/);
  assert.match(robots, /\/api/);
  assert.match(robots, /\/login/);
  assert.match(sitemap, /\/terms/);
  assert.match(sitemap, /\/privacy/);
  assert.doesNotMatch(sitemap, /\/account/);
  assert.doesNotMatch(sitemap, /\/admin/);
  assert.doesNotMatch(sitemap, /\/login/);
});

test("destructive confirm path exists for termination", async () => {
  const buttons = await readFile(
    "components/account/service-change-request-buttons.tsx",
    "utf8",
  );
  const cancelPanel = await readFile(
    "components/account/service-cancel-panel.tsx",
    "utf8",
  );
  assert.match(buttons, /ارتقای سرور/);
  assert.match(buttons, /لغو سرویس/);
  assert.match(cancelPanel, /ConfirmDialog/);
  assert.match(cancelPanel, /لغو سرویس و بازگشت/);
  assert.match(cancelPanel, /مبلغ قابل بازگشت/);
  const dialog = await readFile("components/product/confirm-dialog.tsx", "utf8");
  assert.match(dialog, /Escape/);
  assert.match(dialog, /aria-modal/);
  assert.match(dialog, /focus/);
});

test("renewal panel compares previous and current amount", async () => {
  const panel = await readFile(
    "components/account/subscription-panel.tsx",
    "utf8",
  );
  assert.match(panel, /previousPeriodAmountRial/);
  assert.match(panel, /مبلغ دوره قبل/);
  assert.match(panel, /مبلغ تمدید فعلی/);
  assert.match(panel, /اختلاف/);
});

test("orders and transactions expose pagination", async () => {
  const orders = await readFile("app/account/orders/page.tsx", "utf8");
  const txs = await readFile("components/transactions-panel.tsx", "utf8");
  const queries = await readFile("lib/account/queries.ts", "utf8");
  assert.match(orders, /page=/);
  assert.match(orders, /صفحه‌بندی/);
  assert.match(queries, /skip:/);
  assert.match(txs, /نمایش بیشتر/);
  assert.match(txs, /pageSize/);
});

test("order detail keeps immutable Parchin snapshot fields", async () => {
  const page = await readFile("app/account/orders/[id]/page.tsx", "utf8");
  assert.match(page, /parchinServiceSnapshot/);
  assert.match(page, /readParchinServiceSnapshot/);
  assert.match(page, /قفل‌شده/);
  assert.match(page, /درخواست پشتیبانی برای این سرویس/);
});

test("parchin-derived support priority mapping", () => {
  assert.equal(supportPriorityFromParchin("PARCHIN_START"), "NORMAL");
  assert.equal(supportPriorityFromParchin("PARCHIN_ACTIVE"), "HIGH");
  assert.equal(supportPriorityFromParchin("PARCHIN_STABLE"), "URGENT");
  assert.equal(supportPriorityFromParchin(null), "NORMAL");
});

test("support request ownership and admin access", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const ownerMobile = "09128887001";
  const otherMobile = "09128887002";
  const adminMobile = "09128887003";
  const prior = process.env.ADMIN_MOBILES;
  process.env.ADMIN_MOBILES = [prior, adminMobile].filter(Boolean).join(",");

  await prisma.supportRequestMessage.deleteMany({
    where: { author: { mobile: { in: [ownerMobile, otherMobile, adminMobile] } } },
  });
  await prisma.supportRequest.deleteMany({
    where: { user: { mobile: { in: [ownerMobile, otherMobile, adminMobile] } } },
  });
  await prisma.user.deleteMany({
    where: { mobile: { in: [ownerMobile, otherMobile, adminMobile] } },
  });

  t.after(async () => {
    await prisma!.supportRequestMessage.deleteMany({
      where: {
        author: { mobile: { in: [ownerMobile, otherMobile, adminMobile] } },
      },
    });
    await prisma!.supportRequest.deleteMany({
      where: { user: { mobile: { in: [ownerMobile, otherMobile, adminMobile] } } },
    });
    await prisma!.user.deleteMany({
      where: { mobile: { in: [ownerMobile, otherMobile, adminMobile] } },
    });
    if (prior === undefined) delete process.env.ADMIN_MOBILES;
    else process.env.ADMIN_MOBILES = prior;
  });

  const [owner, other] = await Promise.all([
    prisma.user.create({ data: { mobile: ownerMobile, role: UserRole.CUSTOMER } }),
    prisma.user.create({ data: { mobile: otherMobile, role: UserRole.CUSTOMER } }),
    prisma.user.create({
      data: { mobile: adminMobile, role: UserRole.ADMIN },
    }),
  ]);

  const created = await createSupportRequest({
    userId: owner.id,
    category: SupportRequestCategory.ACCESS,
    subject: "عدم ورود SSH",
    description: "پس از تحویل امکان ورود ندارم و راهنمایی می‌خواهم.",
  });
  assert.equal(created.priority, SupportRequestPriority.NORMAL);
  assert.equal(created.status, SupportRequestStatus.OPEN);

  const owned = await getCustomerSupportRequest(owner.id, created.id);
  assert.equal(owned.id, created.id);

  await assert.rejects(
    () => getCustomerSupportRequest(other.id, created.id),
    (error: unknown) =>
      error instanceof WalletError && error.code === "not_found",
  );

  const adminList = await listAdminSupportRequests({
    status: SupportRequestStatus.OPEN,
  });
  assert.ok(adminList.some((row) => row.id === created.id));
});

test("linked parchin level sets support priority and cannot be customer-chosen", async (t) => {
  if (!prisma) {
    t.skip("DATABASE_URL not set");
    return;
  }
  // Priority is derived server-side from linked order snapshot, not request body.
  const source = await readFile("lib/support/service.ts", "utf8");
  assert.match(source, /priorityForLevel/);
  assert.match(source, /parchinLevel/);
  assert.doesNotMatch(source, /body\.priority/);
  assert.equal(
    SupportRequestPriority.URGENT,
    SupportRequestPriority[
      supportPriorityFromParchin(ParchinLevel.PARCHIN_STABLE)
    ],
  );
});
