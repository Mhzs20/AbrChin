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

export default async function AdminDashboardPage() {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const operations = await getAdminOperationsCenter();

  const connectionTone = (status: string) =>
    status === "healthy" ? "success" : status === "error" ? "danger" : "warning";
  return (
    <>
      <PageHeader
        title="مرکز عملیات"
        description="آمادگی فروش و اقدام بعدی برای سفارش‌های واقعی"
        actions={
          <Link href="/admin/infrastructure/orders" className="product-btn product-btn--primary">
            مشاهده سفارش‌ها و تحویل
          </Link>
        }
      />

      <SectionCard title="آمادگی فروش">
        <div className="product-stat-grid">
          {operations.connections.map((connection) => (
            <StatCard
              key={connection.key}
              label={connection.label}
              value={<StatusBadge label={connection.message} tone={connectionTone(connection.status)} />}
              action={<Link href={connection.href}>اقدام بعدی</Link>}
            />
          ))}
          <StatCard
            label="SKU منتشرشده با قیمت معتبر"
            value={operations.publishedSellableSkuCount.toLocaleString("fa-IR")}
            action={<Link href="/admin/infrastructure/plans">مدیریت SKUها</Link>}
          />
        </div>
      </SectionCard>

      <SectionCard title="صف‌های مالی و عملیاتی">
        <div className="product-stat-grid">
          {operations.queues.map((queue) => {
            return (
              <StatCard
                key={queue.key}
                label={queue.title}
                value={queue.items.length.toLocaleString("fa-IR")}
              >
                <p style={{ margin: 0, color: "var(--product-muted)", fontSize: 13 }}>{queue.description}</p>
                {queue.items.length > 0 ? (
                  <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                    {queue.items.slice(0, 5).map((item) => (
                      <li key={item.id} className="product-tech" style={{ display: "grid", gap: 4 }}>
                        <span>{item.reference.slice(-18)} — {item.summary}</span>
                        <span>
                          <OperationsQueueAction item={item} />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="product-tech">موردی در صف نیست.</p>}
              </StatCard>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
