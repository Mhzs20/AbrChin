import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/product";
import { getAdminOperationsCenter } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { infrastructureOrderStatusLabel } from "@/lib/labels/infrastructure";

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
  const queueCards = [
    {
      key: "provision",
      title: "منتظر تأیید ساخت",
      description: "پرداخت ثبت شده است؛ پیش از ساخت، هزینه و وضعیت Provider را بررسی کنید.",
    },
    {
      key: "delivery",
      title: "منتظر تأیید تحویل",
      description: "Resource آماده است و تا تأیید شما به Customer نمایش داده نمی‌شود.",
    },
    {
      key: "attention",
      title: "نیازمند اقدام",
      description: "خطا یا اختلاف وجود دارد؛ سفارش و پرداخت حفظ شده‌اند و نیاز به تصمیم دارند.",
    },
  ] as const;

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

      <SectionCard title="صف اقدام سفارش‌ها">
        <div className="product-stat-grid">
          {queueCards.map((card) => {
            const orders = operations.queues[card.key];
            return (
              <StatCard
                key={card.key}
                label={card.title}
                value={orders.length.toLocaleString("fa-IR")}
                action={<Link href="/admin/infrastructure/orders">مشاهده و اقدام</Link>}
              >
                <p style={{ margin: 0, color: "var(--product-muted)", fontSize: 13 }}>{card.description}</p>
                {orders.length > 0 ? (
                  <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                    {orders.slice(0, 3).map((order) => (
                      <li key={order.id} className="product-tech">
                        {order.serviceOrderId.slice(-8)} — {order.plan.title} — {infrastructureOrderStatusLabel[order.status]}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </StatCard>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}
