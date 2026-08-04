import type { Metadata } from "next";
import Link from "next/link";

import { OperationsQueueAction } from "@/components/admin/operations-queue-action";
import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/product";
import { getAdminOperationsCenter } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "داشبورد | پنل مدیریت | ابرچین",
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

export default async function AdminDashboardPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const operations = await getAdminOperationsCenter();

  const connectionTone = (status: string) =>
    status === "healthy" ? "success" : status === "error" ? "danger" : "warning";

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

  return (
    <>
      <PageHeader
        title="مرکز عملیات"
        description="اول صف‌های نیازمند اقدام، بعد آمادگی فروش. مسیر فروش: Sync → انتشار SKU → خرید → تأیید ساخت → تحویل."
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
              مدیریت SKU
            </Link>
          </div>
        }
      />

      <SectionCard title="آمادگی فروش">
        <div className="product-stat-grid">
          {operations.connections.map((connection) => (
            <StatCard
              key={connection.key}
              label={connection.label}
              value={
                <StatusBadge
                  label={connection.message}
                  tone={connectionTone(connection.status)}
                />
              }
              action={<Link href={connection.href}>اقدام بعدی</Link>}
            />
          ))}
          <StatCard
            label="SKU منتشرشده با قیمت معتبر"
            value={operations.publishedSellableSkuCount.toLocaleString("fa-IR")}
            action={<Link href="/admin/infrastructure/plans">انتشار / ویرایش SKU</Link>}
          />
        </div>
      </SectionCard>

      <SectionCard
        title={
          actionQueues.length > 0
            ? `نیازمند اقدام الان (${actionQueues.length.toLocaleString("fa-IR")})`
            : "نیازمند اقدام الان"
        }
      >
        {actionQueues.length === 0 ? (
          <p className="product-tech" style={{ margin: 0 }}>
            صف فوری خالی است. اگر سفارش جدیدی آمد، این‌جا یا در «سفارش‌ها و تحویل»
            اقدام کن.
          </p>
        ) : (
          <div className="product-stat-grid">
            {actionQueues.map((queue) => (
              <StatCard
                key={queue.key}
                label={queue.title}
                value={queue.items.length.toLocaleString("fa-IR")}
              >
                <p
                  style={{
                    margin: 0,
                    color: "var(--product-muted)",
                    fontSize: 13,
                  }}
                >
                  {queue.description}
                </p>
                <ul
                  style={{
                    margin: "10px 0 0",
                    padding: 0,
                    listStyle: "none",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {queue.items.slice(0, 5).map((item) => (
                    <li
                      key={item.id}
                      className="product-tech"
                      style={{ display: "grid", gap: 4 }}
                    >
                      <span>
                        {item.reference.slice(-18)} — {item.summary}
                      </span>
                      <span>
                        <OperationsQueueAction item={item} />
                      </span>
                    </li>
                  ))}
                </ul>
              </StatCard>
            ))}
          </div>
        )}
      </SectionCard>

      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          صف‌های خالی و تشخیص پیشرفته (
          {idleQueues.length.toLocaleString("fa-IR")})
        </summary>
        <div className="product-stat-grid" style={{ marginTop: 12 }}>
          {idleQueues.map((queue) => (
            <StatCard
              key={queue.key}
              label={queue.title}
              value="۰"
            >
              <p
                style={{
                  margin: 0,
                  color: "var(--product-muted)",
                  fontSize: 13,
                }}
              >
                {queue.description}
              </p>
            </StatCard>
          ))}
        </div>
      </details>
    </>
  );
}
