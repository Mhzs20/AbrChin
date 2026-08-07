import type { Metadata } from "next";
import Link from "next/link";

import {
  DataTable,
  MoneyDisplay,
  PageHeader,
  ResponsiveRowList,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { getUserOrders } from "@/lib/account/queries";
import { requireCustomerPage } from "@/lib/auth/guards";
import { customerBillingModelLabel } from "@/lib/labels/customer";
import {
  getInfrastructureStage,
  infrastructureOrderStatusLabel,
  serviceOrderStatusLabel,
} from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "سفارش‌های من | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function orderTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "PAID") return "success";
  if (status === "PENDING_PAYMENT") return "warning";
  if (status === "REFUNDED" || status === "CANCELED") return "neutral";
  return "info";
}

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireCustomerPage();
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageRaw || "1", 10) || 1);
  const { orders, total, pageSize } = await getUserOrders(user.id, {
    page,
    pageSize: 20,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const columns = [
    { key: "id", header: "شماره" },
    { key: "title", header: "پلن" },
    { key: "amount", header: "مبلغ" },
    { key: "status", header: "وضعیت" },
    { key: "stage", header: "مرحله" },
    { key: "createdAt", header: "زمان" },
    { key: "actions", header: "" },
  ];

  const rows = orders.map((order) => {
    const infraStatus = order.infrastructureOrder?.status;
    return {
      id: order.id,
      cells: {
        id: <TechnicalValue>{order.id.slice(-8)}</TechnicalValue>,
        title: order.title,
        amount:
          order.status === "ACTIVATION_REQUESTED" ? (
            customerBillingModelLabel(order.plan?.billingModel ?? "PAYG_WALLET")
          ) : (
            <MoneyDisplay amount={formatTomanFa(order.amount)} />
          ),
        status: (
          <StatusBadge
            label={serviceOrderStatusLabel[order.status]}
            tone={orderTone(order.status)}
          />
        ),
        stage: infraStatus
          ? getInfrastructureStage(infraStatus)
          : serviceOrderStatusLabel[order.status],
        createdAt: new Date(order.createdAt).toLocaleString("fa-IR"),
        actions: (
          <Link
            href={`/account/orders/${order.id}`}
            className="product-btn product-btn--quiet"
            style={{ minHeight: 44 }}
          >
            جزئیات
          </Link>
        ),
      },
    };
  });

  const mobileRows = orders.map((order) => ({
    id: order.id,
    title: order.title,
    fields: [
      {
        label: "مبلغ",
        value:
          order.status === "ACTIVATION_REQUESTED" ? (
            customerBillingModelLabel(order.plan?.billingModel ?? "PAYG_WALLET")
          ) : (
            <MoneyDisplay amount={formatTomanFa(order.amount)} />
          ),
      },
      {
        label: "وضعیت",
        value: (
          <StatusBadge
            label={serviceOrderStatusLabel[order.status]}
            tone={orderTone(order.status)}
          />
        ),
      },
      {
        label: "مرحله",
        value: order.infrastructureOrder
          ? infrastructureOrderStatusLabel[order.infrastructureOrder.status]
          : "—",
      },
      { label: "زمان", value: new Date(order.createdAt).toLocaleString("fa-IR") },
    ],
    actions: (
      <Link
        href={`/account/orders/${order.id}`}
        className="product-btn product-btn--quiet"
        style={{ minHeight: 44 }}
      >
        جزئیات
      </Link>
    ),
  }));

  return (
    <>
      <PageHeader title="سفارش‌های من" description="پیگیری وضعیت سفارش‌های زیرساخت" />
      <DataTable columns={columns} rows={rows} emptyMessage="سفارشی ثبت نشده است." />
      <ResponsiveRowList rows={mobileRows} />
      {totalPages > 1 ? (
        <nav
          aria-label="صفحه‌بندی سفارش‌ها"
          style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}
        >
          {page > 1 ? (
            <Link
              className="product-btn product-btn--quiet"
              style={{ minHeight: 44 }}
              href={`/account/orders?page=${page - 1}`}
            >
              قبلی
            </Link>
          ) : null}
          <span style={{ alignSelf: "center" }}>
            صفحه {page.toLocaleString("fa-IR")} از{" "}
            {totalPages.toLocaleString("fa-IR")}
          </span>
          {page < totalPages ? (
            <Link
              className="product-btn product-btn--quiet"
              style={{ minHeight: 44 }}
              href={`/account/orders?page=${page + 1}`}
            >
              بعدی
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
