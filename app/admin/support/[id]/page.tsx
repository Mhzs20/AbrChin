import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminSupportRequestPanel } from "@/components/admin/support-request-admin-panel";
import {
  Breadcrumb,
  PageHeader,
  SectionCard,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { getAdminPageAccess } from "@/lib/auth/guards";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS,
} from "@/lib/labels/customer";
import { getAdminSupportRequest } from "@/lib/support/service";
import { WalletError } from "@/lib/wallet/errors";

export const metadata: Metadata = {
  title: "جزئیات پشتیبانی | پنل مدیریت | ابرچین",
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

export default async function AdminSupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await getAdminPageAccess();
  if (!access.allowed) return null;

  const { id } = await params;
  let request;
  try {
    request = await getAdminSupportRequest(id);
  } catch (error) {
    if (error instanceof WalletError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <PageHeader
        title={request.subject}
        description="رسیدگی، پاسخ و به‌روزرسانی وضعیت"
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "پشتیبانی", href: "/admin/support" },
              { label: "جزئیات" },
            ]}
          />
        }
        actions={
          <Link href="/admin/support" className="product-btn product-btn--quiet">
            بازگشت به فهرست
          </Link>
        }
      />

      <SectionCard title="مشتری و سرویس">
        <dl
          style={{
            display: "grid",
            gap: 12,
            margin: 0,
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          }}
        >
          <div>
            <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>مشتری</dt>
            <dd style={{ margin: "4px 0 0" }}>
              {request.user.displayName || "—"}
              <br />
              <TechnicalValue>{request.user.mobile}</TechnicalValue>
            </dd>
          </div>
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
          {request.parchinLevel ? (
            <div>
              <dt style={{ color: "var(--product-muted)", fontSize: 13 }}>پرچین</dt>
              <dd style={{ margin: "4px 0 0" }}>{request.parchinLevel}</dd>
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
                    ? message.author.displayName || "پشتیبانی"
                    : message.author.displayName || request.user.mobile}
                </strong>
                <span>{new Date(message.createdAt).toLocaleString("fa-IR")}</span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{message.body}</p>
            </article>
          ))}
        </div>
      </SectionCard>

      <AdminSupportRequestPanel
        requestId={request.id}
        currentStatus={request.status}
      />
    </>
  );
}
