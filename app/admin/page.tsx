import type { Metadata } from "next";
import Link from "next/link";

import { OperationsQueueAction } from "@/components/admin/operations-queue-action";
import {
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/product";
import { getAdminOperationsCenter } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "مرکز عملیات | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const launchPriority = [
  "deliveryApproval",
  "activationApproval",
  "resourceChangeFulfillment",
  "resourceChangeApproval",
  "provisionRecovery",
  "walletPaymentReview",
  "walletCreditReconciliation",
  "controlledRefund",
  "connectionFailure",
  "suspensionReview",
  "lowBalance",
  "unpaidInvoice",
  "providerBillingReconciliation",
] as const;

function connectionTone(status: string) {
  if (status === "healthy") return "success" as const;
  if (status === "error") return "danger" as const;
  return "warning" as const;
}

function connectionReadyLabel(status: string) {
  if (status === "healthy") return "آماده";
  if (status === "error") return "خطا";
  if (status === "unconfigured") return "تنظیم نشده";
  return "نیازمند بررسی";
}

export default async function AdminDashboardPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const operations = await getAdminOperationsCenter();

  const sortedQueues = [...operations.queues].sort((a, b) => {
    const aBusy = a.items.length > 0 ? 0 : 1;
    const bBusy = b.items.length > 0 ? 0 : 1;
    if (aBusy !== bBusy) return aBusy - bBusy;
    const aRank = launchPriority.indexOf(
      a.key as (typeof launchPriority)[number],
    );
    const bRank = launchPriority.indexOf(
      b.key as (typeof launchPriority)[number],
    );
    return (aRank === -1 ? 99 : aRank) - (bRank === -1 ? 99 : bRank);
  });
  const actionQueues = sortedQueues.filter((queue) => queue.items.length > 0);
  const idleQueues = sortedQueues.filter((queue) => queue.items.length === 0);
  const actionItemCount = actionQueues.reduce(
    (sum, queue) => sum + queue.items.length,
    0,
  );

  const saleChecks = operations.connections.filter(
    (connection) => connection.group === "sale",
  );
  const advancedChecks = operations.connections.filter(
    (connection) => connection.group === "advanced",
  );
  const saleBlocked = saleChecks.filter(
    (connection) => connection.status !== "healthy",
  );
  const saleReady =
    saleBlocked.length === 0 && operations.publishedSellableSkuCount > 0;

  const nextStep =
    actionItemCount > 0
      ? {
          tone: "warning" as const,
          title: `${actionItemCount.toLocaleString("fa-IR")} کار منتظر شماست`,
          body: "اول صف اقدام را انجام بده؛ معمولاً تحویل یا تأیید ساخت.",
          href: "#ops-actions",
          cta: "رفتن به صف اقدام",
        }
      : !saleReady
        ? {
            tone: "warning" as const,
            title: "فروش هنوز کامل آماده نیست",
            body:
              saleBlocked.length > 0
                ? `این بخش‌ها را درست کن: ${saleBlocked.map((item) => item.label).join("، ")}`
                : "حداقل یک SKU منتشرشده با قیمت معتبر لازم است.",
            href: saleBlocked[0]?.href ?? "/admin/infrastructure/plans",
            cta: "رفع آمادگی فروش",
          }
        : {
            tone: "success" as const,
            title: "صف خالی است — فروش آماده است",
            body: `${operations.publishedSellableSkuCount.toLocaleString("fa-IR")} SKU منتشرشده. وقتی سفارش بیاید همین‌جا می‌بینی.`,
            href: "/admin/infrastructure/orders",
            cta: "سفارش‌ها و تحویل",
          };

  return (
    <>
      <PageHeader
        title="مرکز عملیات"
        description="یک نگاه: الان چه کاری لازم است، فروش آماده‌ست یا نه، و میانبر مسیر فروش."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href="/admin/infrastructure/orders"
              className="product-btn product-btn--primary"
            >
              سفارش‌ها و تحویل
            </Link>
            <Link
              href="/admin/infrastructure/plans"
              className="product-btn product-btn--quiet"
            >
              SKUهای قابل‌فروش
            </Link>
          </div>
        }
      />

      <section
        className="product-section"
        style={{
          borderColor:
            nextStep.tone === "success"
              ? "rgba(22, 163, 74, 0.35)"
              : "rgba(217, 119, 6, 0.35)",
          background:
            nextStep.tone === "success"
              ? "rgba(22, 163, 74, 0.06)"
              : "rgba(217, 119, 6, 0.06)",
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: "var(--product-muted)" }}>
          قدم بعدی
        </p>
        <h2 style={{ margin: "6px 0 8px", fontSize: 22 }}>
          {nextStep.title}
        </h2>
        <p style={{ margin: "0 0 14px", maxWidth: 640 }}>{nextStep.body}</p>
        <Link href={nextStep.href} className="product-btn product-btn--primary">
          {nextStep.cta}
        </Link>
      </section>

      <SectionCard title="مسیر فروش (به‌ترتیب)">
        <ol
          style={{
            margin: 0,
            paddingInlineStart: 22,
            display: "grid",
            gap: 8,
            color: "var(--product-muted)",
          }}
        >
          <li>
            Sync منابع{" "}
            <Link href="/admin/infrastructure/providers">Arvan / ParsPack</Link>
          </li>
          <li>
            انتشار SKU در{" "}
            <Link href="/admin/infrastructure/plans">SKUهای قابل‌فروش</Link>
          </li>
          <li>
            چینش نمایش در{" "}
            <Link href="/admin/infrastructure/storefront">چینش فروشگاهی</Link>
          </li>
          <li>
            خرید مشتری → تأیید اول / تحویل در{" "}
            <Link href="/admin/infrastructure/orders">سفارش‌ها و تحویل</Link>
          </li>
        </ol>
      </SectionCard>

      <SectionCard
        title={
          actionItemCount > 0
            ? `۱. صف اقدام (${actionItemCount.toLocaleString("fa-IR")})`
            : "۱. صف اقدام"
        }
      >
        <div id="ops-actions" />
        {actionQueues.length === 0 ? (
          <p style={{ margin: 0, color: "var(--product-muted)" }}>
            فعلاً کاری در صف نیست. سفارش جدید این‌جا ظاهر می‌شود.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {actionQueues.map((queue) => (
              <div
                key={queue.key}
                style={{
                  border: "1px solid var(--product-border, #ddd)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "baseline",
                  }}
                >
                  <div>
                    <strong>{queue.title}</strong>
                    <p
                      style={{
                        margin: "4px 0 0",
                        color: "var(--product-muted)",
                        fontSize: 13,
                      }}
                    >
                      {queue.description}
                    </p>
                  </div>
                  <StatusBadge
                    label={`${queue.items.length.toLocaleString("fa-IR")} مورد`}
                    tone="warning"
                  />
                </div>
                <div className="product-table-wrap">
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>مورد</th>
                        <th>خلاصه</th>
                        <th>اقدام</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.items.slice(0, 8).map((item) => (
                        <tr key={item.id}>
                          <td>
                            <span className="product-tech">
                              {item.reference.slice(-18)}
                            </span>
                          </td>
                          <td>{item.summary}</td>
                          <td>
                            <OperationsQueueAction item={item} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {queue.items.length > 8 ? (
                  <p className="product-muted" style={{ margin: 0, fontSize: 13 }}>
                    و {(queue.items.length - 8).toLocaleString("fa-IR")} مورد
                    دیگر در همین صف.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="۲. آمادگی فروش">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
            alignItems: "center",
          }}
        >
          <StatusBadge
            label={saleReady ? "فروش از نظر زیرساخت آماده است" : "فروش ناقص است"}
            tone={saleReady ? "success" : "warning"}
          />
          <Link href="/admin/infrastructure/plans" className="product-btn product-btn--quiet">
            {operations.publishedSellableSkuCount.toLocaleString("fa-IR")} SKU
            منتشرشده
          </Link>
        </div>
        <div className="product-table-wrap">
          <table className="product-table">
            <thead>
              <tr>
                <th>بخش</th>
                <th>وضعیت</th>
                <th>توضیح</th>
                <th>اقدام</th>
              </tr>
            </thead>
            <tbody>
              {saleChecks.map((connection) => (
                <tr key={connection.key}>
                  <td>{connection.label}</td>
                  <td>
                    <StatusBadge
                      label={connectionReadyLabel(connection.status)}
                      tone={connectionTone(connection.status)}
                    />
                  </td>
                  <td style={{ color: "var(--product-muted)", fontSize: 13 }}>
                    {connection.message}
                  </td>
                  <td>
                    <Link href={connection.href}>باز کردن</Link>
                  </td>
                </tr>
              ))}
              <tr>
                <td>SKU منتشرشده</td>
                <td>
                  <StatusBadge
                    label={
                      operations.publishedSellableSkuCount > 0
                        ? "آماده"
                        : "خالی"
                    }
                    tone={
                      operations.publishedSellableSkuCount > 0
                        ? "success"
                        : "warning"
                    }
                  />
                </td>
                <td style={{ color: "var(--product-muted)", fontSize: 13 }}>
                  مشتری فقط SKUهای Published را می‌بیند
                </td>
                <td>
                  <Link href="/admin/infrastructure/plans">مدیریت SKU</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="۳. میانبرهای پرکاربرد">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 8,
          }}
        >
          {(
            [
              ["/admin/infrastructure/orders", "سفارش‌ها و تحویل"],
              ["/admin/infrastructure/plans", "SKUهای قابل‌فروش"],
              ["/admin/infrastructure/storefront", "چینش فروشگاهی"],
              ["/admin/wallets", "کیف پول‌ها"],
              ["/admin/users", "کاربران"],
              ["/admin/infrastructure/regions", "مناطق فروش"],
              ["/admin/connections", "اتصال سرویس‌ها"],
              ["/admin/notifications", "اعلان‌ها"],
            ] as const
          ).map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="product-btn product-btn--quiet"
              style={{ justifyContent: "center" }}
            >
              {label}
            </Link>
          ))}
        </div>
      </SectionCard>

      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          تشخیص پیشرفته (Billing و صف‌های خالی)
        </summary>
        <div style={{ marginTop: 12, display: "grid", gap: 16 }}>
          <div className="product-table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>تشخیص</th>
                  <th>وضعیت</th>
                  <th>جزئیات</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {advancedChecks.map((connection) => (
                  <tr key={connection.key}>
                    <td>{connection.label}</td>
                    <td>
                      <StatusBadge
                        label={connectionReadyLabel(connection.status)}
                        tone={connectionTone(connection.status)}
                      />
                    </td>
                    <td
                      className="product-tech"
                      style={{ fontSize: 12, maxWidth: 360 }}
                    >
                      {connection.message}
                    </td>
                    <td>
                      <Link href={connection.href}>باز کردن</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, color: "var(--product-muted)", fontSize: 13 }}>
            صف‌های خالی ({idleQueues.length.toLocaleString("fa-IR")}) — فقط برای
            مرجع؛ الان کاری ندارند.
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 8,
            }}
          >
            {idleQueues.map((queue) => (
              <li
                key={queue.key}
                style={{
                  border: "1px solid var(--product-border, #ddd)",
                  borderRadius: 10,
                  padding: 10,
                  fontSize: 13,
                }}
              >
                <strong>{queue.title}</strong>
                <div style={{ color: "var(--product-muted)", marginTop: 4 }}>
                  ۰ مورد
                </div>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
