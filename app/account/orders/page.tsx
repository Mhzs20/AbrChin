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

export default async function AccountOrdersPage() {
  const user = await requireCustomerPage();

  const orders = await getUserOrders(user.id);
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
          order.status === "ACTIVATION_REQUESTED"
            ? "PAYG / Wallet"
            : <MoneyDisplay amount={formatTomanFa(order.amount)} />,
        status: <StatusBadge label={serviceOrderStatusLabel[order.status]} tone={orderTone(order.status)} />,
        stage: infraStatus
          ? getInfrastructureStage(infraStatus)
          : serviceOrderStatusLabel[order.status],
        createdAt: new Date(order.createdAt).toLocaleString("fa-IR"),
        actions: (
          <Link href={`/account/orders/${order.id}`} className="product-btn product-btn--quiet">
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
          order.status === "ACTIVATION_REQUESTED"
            ? "PAYG / Wallet"
            : <MoneyDisplay amount={formatTomanFa(order.amount)} />,
      },
      {
        label: "وضعیت",
        value: <StatusBadge label={serviceOrderStatusLabel[order.status]} tone={orderTone(order.status)} />,
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
      <Link href={`/account/orders/${order.id}`} className="product-btn product-btn--quiet">
        جزئیات
      </Link>
    ),
  }));

  return (
    <>
      <PageHeader title="سفارش‌های من" description="پیگیری وضعیت سفارش‌های زیرساخت" />
      <DataTable columns={columns} rows={rows} emptyMessage="سفارشی ثبت نشده است." />
      <ResponsiveRowList rows={mobileRows} />
    </>
  );
}
