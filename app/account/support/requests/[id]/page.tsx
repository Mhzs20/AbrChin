import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SupportRequestReplyForm } from "@/components/account/support-request-reply-form";
import {
  Breadcrumb,
  PageHeader,
  SectionCard,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
} from "@/lib/labels/customer";
import { getCustomerSupportRequest } from "@/lib/support/service";
import { WalletError } from "@/lib/wallet/errors";

export const metadata: Metadata = {
  title: "جزئیات درخواست پشتیبانی | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "RESOLVED") return "success";
  if (status === "IN_PROGRESS") return "warning";
  if (status === "OPEN") return "info";
  return "neutral";
}

export default async function SupportRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerPage();
  const { id } = await params;

  let request;
  try {
    request = await getCustomerSupportRequest(user.id, id);
  } catch (error) {
    if (error instanceof WalletError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const closed =
    request.status === "CLOSED" || request.status === "RESOLVED";

  return (
    <>
      <PageHeader
        title={request.subject}
        description="جزئیات درخواست و گفتگو با پشتیبانی ابرچین"
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "پشتیبانی", href: "/account/support" },
              { label: "جزئیات" },
            ]}
          />
        }
        actions={
          <Link href="/account/support" className="product-btn product-btn--quiet">
            فهرست درخواست‌ها
          </Link>
        }
      />

      <SectionCard title="خلاصه">
        <dl
          style={{
            display: "grid",
            gap: 12,
            margin: 0,
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>وضعیت</dt>
            <dd style={{ margin: "4px 0 0" }}>
              <StatusBadge
                label={SUPPORT_STATUS_LABELS[request.status] ?? request.status}
                tone={statusTone(request.status)}
              />
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>اولویت</dt>
            <dd style={{ margin: "4px 0 0" }}>
              {SUPPORT_PRIORITY_LABELS[request.priority] ?? request.priority}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>دسته</dt>
            <dd style={{ margin: "4px 0 0" }}>
              {SUPPORT_CATEGORY_LABELS[request.category] ?? request.category}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>زمان ثبت</dt>
            <dd style={{ margin: "4px 0 0" }}>
              {new Date(request.createdAt).toLocaleString("fa-IR")}
            </dd>
          </div>
          {request.cloudInstance ? (
            <div>
              <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>سرویس</dt>
              <dd style={{ margin: "4px 0 0" }}>
                {request.cloudInstance.name}
                {request.cloudInstance.ipv4 ? (
                  <>
                    {" "}
                    · <TechnicalValue>{request.cloudInstance.ipv4}</TechnicalValue>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
          {request.serviceOrder ? (
            <div>
              <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>سفارش</dt>
              <dd style={{ margin: "4px 0 0" }}>{request.serviceOrder.title}</dd>
            </div>
          ) : null}
        </dl>
        <p style={{ margin: "16px 0 0", whiteSpace: "pre-wrap" }}>
          {request.description}
        </p>
      </SectionCard>

      <SectionCard title="گفتگو">
        <div className="support-thread">
          {request.messages.map((message) => (
            <article
              key={message.id}
              className={`support-message${message.isStaff ? " is-staff" : ""}`}
            >
              <div className="support-message-meta">
                <strong>
                  {message.isStaff
                    ? "پشتیبانی ابرچین"
                    : message.author.displayName || "شما"}
                </strong>
                <span>{new Date(message.createdAt).toLocaleString("fa-IR")}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
            </article>
          ))}
        </div>
      </SectionCard>

      <SupportRequestReplyForm requestId={request.id} closed={closed} />
    </>
  );
}
