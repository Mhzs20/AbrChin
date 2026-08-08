import type { Metadata } from "next";
import Link from "next/link";

import { InfrastructureOrderActions } from "@/components/admin/infrastructure-order-actions";
import { DeliveryApprovalActions } from "@/components/admin/delivery-approval-actions";
import { ManualProvisionButton } from "@/components/admin/manual-ready-delivery-button";
import { ProvisionApprovalActions } from "@/components/admin/provision-approval-actions";
import {
  MoneyDisplay,
  PageHeader,
  StatusBadge,
} from "@/components/product";
import { listInfrastructureOrders } from "@/lib/admin/dashboard";
import { getAdminPageAccess } from "@/lib/auth/guards";
import { getProvisionApprovalReview } from "@/lib/infrastructure/provision-approval";
import { getDeliveryApprovalReview } from "@/lib/infrastructure/delivery-approval";
import { getInfrastructureAttention } from "@/lib/infrastructure/attention";
import { infrastructureOrderStatusLabel } from "@/lib/labels/infrastructure";
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
    const costAmount = (value: string | null) =>
      value == null ? null : formatTomanFa(BigInt(value));
    const costNode = (value: string | null) => {
      const amount = costAmount(value);
      return amount == null ? (
        "—"
      ) : (
        <MoneyDisplay amount={amount} tone="cost" />
      );
    };
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <span>Source: {review.sku.source}</span>
        <span>Snapshot: {costNode(review.pricing.providerCostSnapshotRial)}</span>
        <span>فعلی: {costNode(review.pricing.providerCostCurrentRial)}</span>
        <span>
          Margin:{" "}
          {costAmount(review.pricing.currentMarginRial) == null
            ? "—"
            : `${costAmount(review.pricing.currentMarginRial)} تومان`}
        </span>
        <span>Availability: {review.availability.available ? "تأیید" : "نیازمند بررسی"}</span>
        <span>Freshness: {review.availability.fresh ? "تازه" : "کهنه/نامشخص"}</span>
        <span>{review.balance.message}</span>
      </div>
    );
  };

  type LaneKey =
    | "APPROVAL"
    | "BUILD"
    | "DELIVERY"
    | "ATTENTION"
    | "DONE"
    | "CLOSED";
  const laneFor = (order: (typeof orders)[number]): LaneKey => {
    if (deliveryReviewByOrderId.has(order.id)) return "DELIVERY";
    if (reviewByOrderId.has(order.id)) return "APPROVAL";
    if (
      order.status === "QUEUED" ||
      order.status === "PROVISIONING" ||
      (order.status === "FUNDING_CONFIRMED" &&
        order.productFlowState === "PROVISION_APPROVED")
    ) {
      return "BUILD";
    }
    if (order.status === "ACTIVE") return "DONE";
    if (order.status === "CANCELED" || order.status === "REFUNDED") {
      return "CLOSED";
    }
    return "ATTENTION";
  };
  const laneDefinitions: Array<{
    key: LaneKey;
    title: string;
    description: string;
    nextAction: string;
  }> = [
    {
      key: "APPROVAL",
      title: "۱. تأیید ساخت",
      description: "پرداخت ثبت شده؛ قیمت خرید و امکان تأمین را بازبینی کن.",
      nextAction: "بازبینی و ثبت تأیید اول",
    },
    {
      key: "BUILD",
      title: "۲. ساخت و ثبت مشخصات",
      description: "تأیید اول انجام شده؛ سرور را بساز و IP و Credential را ثبت کن.",
      nextAction: "ثبت نتیجه ساخت",
    },
    {
      key: "DELIVERY",
      title: "۳. تأیید تحویل",
      description: "سرور آماده است؛ سلامت و Credential را بازبینی و تحویل را تأیید کن.",
      nextAction: "ثبت تأیید دوم و تحویل",
    },
    {
      key: "ATTENTION",
      title: "نیازمند رسیدگی",
      description: "سفارش‌هایی که مسیر عادی را کامل نکرده‌اند یا به بازیابی نیاز دارند.",
      nextAction: "بررسی مانع و اقدام بازیابی",
    },
    {
      key: "DONE",
      title: "تحویل‌شده",
      description: "سفارش‌های فعال برای مشاهده سابقه؛ اقدام روزمره ندارند.",
      nextAction: "مشاهده سابقه",
    },
    {
      key: "CLOSED",
      title: "بسته‌شده",
      description: "سفارش‌های لغوشده یا بازپرداخت‌شده برای نگهداری سابقه.",
      nextAction: "مشاهده سابقه مالی",
    },
  ];
  const lanes = laneDefinitions.map((lane) => ({
    ...lane,
    orders: orders.filter((order) => laneFor(order) === lane.key),
  }));
  const actionableCount = lanes
    .filter((lane) => lane.key !== "DONE" && lane.key !== "CLOSED")
    .reduce((total, lane) => total + lane.orders.length, 0);

  return (
    <>
      <PageHeader
        title="سفارش‌ها و تحویل"
        description={`${actionableCount.toLocaleString("fa-IR")} سفارش نیازمند اقدام. ترتیب قفل‌شده: تأیید ساخت ← ثبت مشخصات ← تأیید تحویل.`}
      />
      {orders.length === 0 ? (
        <section className="product-section product-empty">
          هنوز سفارشی ثبت نشده است. سفارش پرداخت‌شده مشتری در صف تأیید ساخت ظاهر می‌شود.
        </section>
      ) : (
        <div className="admin-order-board">
          {lanes.map((lane) => (
            <section className="admin-order-lane" key={lane.key}>
              <header>
                <div>
                  <h2>{lane.title}</h2>
                  <p>{lane.description}</p>
                </div>
                <StatusBadge
                  label={`${lane.orders.length.toLocaleString("fa-IR")} سفارش`}
                  tone={
                    lane.orders.length > 0 &&
                    lane.key !== "DONE" &&
                    lane.key !== "CLOSED"
                      ? "warning"
                      : "neutral"
                  }
                />
              </header>

              {lane.orders.length === 0 ? (
                <p className="admin-order-lane-empty">موردی در این مرحله نیست.</p>
              ) : (
                <div className="admin-order-card-grid">
                  {lane.orders.map((order) => (
                    <article className="admin-order-card" key={order.id}>
                      <header>
                        <div>
                          <span className="admin-order-reference">
                            سفارش {order.serviceOrderId.slice(-8)}
                          </span>
                          <h3>{order.plan.title}</h3>
                        </div>
                        <StatusBadge
                          label={infrastructureOrderStatusLabel[order.status]}
                          tone={lane.key === "DONE" ? "success" : "info"}
                        />
                      </header>

                      <dl className="admin-order-facts">
                        <div>
                          <dt>مشتری</dt>
                          <dd>{order.user.displayName || order.user.mobile}</dd>
                        </div>
                        <div>
                          <dt>فروش</dt>
                          <dd><MoneyDisplay amount={formatTomanFa(order.serviceOrder.amount)} tone="sale" /></dd>
                        </div>
                        <div>
                          <dt>هزینه تأمین</dt>
                          <dd><MoneyDisplay amount={formatTomanFa(order.requiredFundingRial)} tone="cost" /></dd>
                        </div>
                        <div>
                          <dt>موقعیت</dt>
                          <dd>{order.plan.regionCode}</dd>
                        </div>
                      </dl>

                      <div className="admin-order-next">
                        <small>اقدام بعدی</small>
                        <strong>{lane.nextAction}</strong>
                      </div>

                      <div className="admin-order-actions">{actionFor(order)}</div>

                      <details className="admin-order-technical">
                        <summary>جزئیات بازبینی و اطلاعات فنی</summary>
                        {reviewSummary(order)}
                      </details>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
