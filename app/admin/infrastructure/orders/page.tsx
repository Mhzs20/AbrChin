import type { Metadata } from "next";
import Link from "next/link";

import { InfrastructureOrderActions } from "@/components/admin/infrastructure-order-actions";
import { DeliveryApprovalActions } from "@/components/admin/delivery-approval-actions";
import { ManualProvisionButton } from "@/components/admin/manual-ready-delivery-button";
import { ProvisionApprovalActions } from "@/components/admin/provision-approval-actions";
import {
  DataTable,
  MoneyDisplay,
  PageHeader,
  ResponsiveRowList,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { listInfrastructureOrders } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { getProvisionApprovalReview } from "@/lib/infrastructure/provision-approval";
import { getDeliveryApprovalReview } from "@/lib/infrastructure/delivery-approval";
import { getInfrastructureAttention } from "@/lib/infrastructure/attention";
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
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;
  const orders = await listInfrastructureOrders();
  const reviewableStatuses = new Set([
    "WAITING_ADMIN_FUNDING",
    "MANUAL_REVIEW",
    "BLOCKED_PROVIDER_BALANCE",
  ]);
  const reviews = await Promise.all(
    orders
      .filter(
        (order) =>
          reviewableStatuses.has(order.status) &&
          order.productFlowState === "PAID",
      )
      .map((order) => getProvisionApprovalReview(order.id)),
  );
  const reviewByOrderId = new Map(reviews.map((review) => [review.infrastructureOrderId, review]));
  const deliveryReviews = await Promise.all(
    orders
      .filter((order) => order.productFlowState === "WAITING_ADMIN_DELIVERY_APPROVAL")
      .map((order) => getDeliveryApprovalReview(order.id)),
  );
  const deliveryReviewByOrderId = new Map(
    deliveryReviews.map((review) => [review.infrastructureOrderId, review]),
  );

  const columns = [
    { key: "order", header: "سفارش" },
    { key: "customer", header: "مشتری" },
    { key: "plan", header: "پلن" },
    { key: "sale", header: "فروش" },
    { key: "providerCost", header: "هزینه Provider" },
    { key: "payment", header: "پرداخت" },
    { key: "review", header: "بازبینی ساخت / تحویل / توجه" },
    { key: "region", header: "Region" },
    { key: "status", header: "وضعیت" },
    { key: "actions", header: "عملیات" },
  ];

  const actionFor = (order: (typeof orders)[number]) => {
    const deliveryReview = deliveryReviewByOrderId.get(order.id);
    if (deliveryReview) {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {order.cloudInstance ? (
            <Link className="product-btn product-btn--quiet" href={`/admin/instances/${order.cloudInstance.id}`}>
              بازبینی محافظت‌شدهٔ Credential
            </Link>
          ) : null}
          <DeliveryApprovalActions
            orderId={order.id}
            canApprove={deliveryReview.canApprove}
            blockingMessages={deliveryReview.blockingIssues.map((issue) => issue.message)}
          />
        </div>
      );
    }
    const review = reviewByOrderId.get(order.id);
    if (review) {
      return (
        <ProvisionApprovalActions
          orderId={order.id}
          serviceOrderId={order.serviceOrderId}
          canApprove={review.canApprove}
          requiresBalanceConfirmation={review.balance.requiresConfirmation}
          provisioningLabel={review.provisioning.label}
          blockingMessages={review.blockingIssues.map((issue) => issue.message)}
        />
      );
    }
    if (order.status === "FUNDING_CONFIRMED") {
      if (
        order.productFlowState === "PROVISION_APPROVED" &&
        order.plan.offerSource !== "PREPROVISIONED_INVENTORY"
      ) {
        return <ManualProvisionButton orderId={order.id} />;
      }
      return <span className="product-tech">فرمان تأیید ثبت شد؛ اجرای کنترل‌شده در صف بعدی است.</span>;
    }
    return (
      <InfrastructureOrderActions
        orderId={order.id}
        serviceOrderId={order.serviceOrderId}
        allowedActions={order.recovery.allowedActions}
        resourceDispositionReason={order.recovery.resourceDispositionReason}
      />
    );
  };

  const reviewSummary = (order: (typeof orders)[number]) => {
    const deliveryReview = deliveryReviewByOrderId.get(order.id);
    if (deliveryReview) {
      const resource = deliveryReview.resource;
      return (
        <div style={{ display: "grid", gap: 4 }}>
          <span>Source: {deliveryReview.provider.source}</span>
          <span>Resource: {resource.providerResourceId ?? "—"}</span>
          <span>IP: {resource.ipv4 ?? "—"}</span>
          <span>Region/Plan/Image: {resource.region ?? "—"} / {resource.plan ?? "—"} / {resource.image ?? "—"}</span>
          <span>Power: {resource.powerState ?? "—"}</span>
          <span>Health: {deliveryReview.health.status ?? "—"} ({deliveryReview.health.resultCode ?? "—"})</span>
          <span>Credential: {deliveryReview.credential.status ?? "—"}</span>
          {deliveryReview.warnings.map((warning) => <span key={warning.code}>{warning.message}</span>)}
        </div>
      );
    }
    const review = reviewByOrderId.get(order.id);
    if (!review) {
      const attention = getInfrastructureAttention({
        status: order.status,
        productFlowState: order.productFlowState,
        updatedAt: order.updatedAt,
        hasResource: Boolean(order.cloudInstance),
        attempts: order.provisioningJobs.map((job) => ({
          operation: job.operation,
          attempt: job.attempt,
          status: job.status,
          lastErrorCode: job.lastErrorCode,
          updatedAt: job.updatedAt,
        })),
        allowedActions: order.recovery.allowedActions,
      });
      if (!attention) return "—";
      return (
        <div style={{ display: "grid", gap: 4 }}>
          <strong>{attention.title}</strong>
          <span>{attention.detail}</span>
          <span>زمان: {new Date(attention.occurredAt).toLocaleString("fa-IR")}</span>
          <span>
            آخرین تلاش: {attention.lastAttempt
              ? `${attention.lastAttempt.operation} #${attention.lastAttempt.attempt} (${attention.lastAttempt.status})`
              : "—"}
          </span>
          <span>اقدام بعدی: {attention.nextActions.join("، ") || "بررسی دستی"}</span>
        </div>
      );
    }
    const cost = (value: string | null) =>
      value == null ? "—" : formatTomanFa(BigInt(value));
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <span>Source: {review.sku.source}</span>
        <span>Snapshot: {cost(review.pricing.providerCostSnapshotRial)} تومان</span>
        <span>فعلی: {cost(review.pricing.providerCostCurrentRial)} تومان</span>
        <span>Margin: {cost(review.pricing.currentMarginRial)} تومان</span>
        <span>Availability: {review.availability.available ? "تأیید" : "نیازمند بررسی"}</span>
        <span>Freshness: {review.availability.fresh ? "تازه" : "کهنه/نامشخص"}</span>
        <span>{review.balance.message}</span>
      </div>
    );
  };

  const rows = orders.map((order) => {
    const review = reviewByOrderId.get(order.id);
    return {
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
      payment: (
        <div>
          <div>{review?.payment.gateway ?? "ثبت مالی داخلی"}</div>
          <div className="product-tech">{review?.payment.reference ?? "—"}</div>
        </div>
      ),
      review: reviewSummary(order),
      region: <TechnicalValue>{order.plan.regionCode}</TechnicalValue>,
      status: <StatusBadge label={infrastructureOrderStatusLabel[order.status]} tone="info" />,
      actions: actionFor(order),
      },
    };
  });

  const mobileRows = orders.map((order) => ({
    id: order.id,
    title: order.plan.title,
    fields: [
      { label: "مشتری", value: order.user.mobile },
      { label: "وضعیت", value: infrastructureOrderStatusLabel[order.status] },
      { label: "RAW/MANAGED", value: deliveryModeLabel[order.deliveryMode] },
      { label: "فروش", value: <MoneyDisplay amount={formatTomanFa(order.serviceOrder.amount)} /> },
      { label: "بازبینی", value: reviewSummary(order) },
    ],
    actions: actionFor(order),
  }));

  return (
    <>
      <PageHeader title="سفارش‌های تأمین" description="بازبینی پرداخت، هزینه و موجودی پیش از صدور فرمان ساخت یا تخصیص" />
      <DataTable columns={columns} rows={rows} />
      <ResponsiveRowList rows={mobileRows} />
    </>
  );
}
