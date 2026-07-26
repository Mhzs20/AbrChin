import type { Metadata } from "next";

import { FundingConfirmButton } from "@/components/admin/funding-confirm-button";
import {
  DataTable,
  MoneyDisplay,
  PageHeader,
  ResponsiveRowList,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { listInfrastructureOrders } from "@/lib/admin/dashboard";
import { guardAdminPage } from "@/lib/admin/auth";
import {
  deliveryModeLabel,
  infrastructureOrderStatusLabel,
} from "@/lib/labels/infrastructure";
import { formatTomanFa } from "@/lib/money";

export const metadata: Metadata = {
  title: "سفارش‌های تأمین | پنل مدیریت | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminInfrastructureOrdersPage() {
  const admin = await guardAdminPage();
  const orders = await listInfrastructureOrders();

  const columns = [
    { key: "order", header: "سفارش" },
    { key: "customer", header: "مشتری" },
    { key: "plan", header: "پلن" },
    { key: "sale", header: "فروش" },
    { key: "providerCost", header: "هزینه Provider" },
    { key: "region", header: "Region" },
    { key: "status", header: "وضعیت" },
    { key: "actions", header: "عملیات" },
  ];

  const rows = orders.map((order) => ({
    id: order.id,
    cells: {
      order: <TechnicalValue>{order.serviceOrderId.slice(-8)}</TechnicalValue>,
      customer: (
        <div>
          <div>{order.user.displayName || "—"}</div>
          <div className="product-tech">{order.user.mobile}</div>
        </div>
      ),
      plan: order.plan.title,
      sale: <MoneyDisplay amount={formatTomanFa(order.serviceOrder.amount)} />,
      providerCost: <MoneyDisplay amount={formatTomanFa(order.requiredFundingRial)} />,
      region: <TechnicalValue>{order.plan.regionCode}</TechnicalValue>,
      status: <StatusBadge label={infrastructureOrderStatusLabel[order.status]} tone="info" />,
      actions:
        order.status === "WAITING_ADMIN_FUNDING" ? (
          <FundingConfirmButton
            orderId={order.id}
            requiredTomanFa={formatTomanFa(order.requiredFundingRial)}
            adminName={admin.displayName || admin.mobile}
          />
        ) : (
          "—"
        ),
    },
  }));

  const mobileRows = orders.map((order) => ({
    id: order.id,
    title: order.plan.title,
    fields: [
      { label: "مشتری", value: order.user.mobile },
      { label: "وضعیت", value: infrastructureOrderStatusLabel[order.status] },
      { label: "RAW/MANAGED", value: deliveryModeLabel[order.deliveryMode] },
      { label: "فروش", value: <MoneyDisplay amount={formatTomanFa(order.serviceOrder.amount)} /> },
    ],
    actions:
      order.status === "WAITING_ADMIN_FUNDING" ? (
        <FundingConfirmButton
          orderId={order.id}
          requiredTomanFa={formatTomanFa(order.requiredFundingRial)}
          adminName={admin.displayName || admin.mobile}
        />
      ) : null,
  }));

  return (
    <>
      <PageHeader title="سفارش‌های تأمین" description="مدیریت شارژ دستی پارس‌پک و صف Provisioning" />
      <DataTable columns={columns} rows={rows} />
      <ResponsiveRowList rows={mobileRows} />
    </>
  );
}
