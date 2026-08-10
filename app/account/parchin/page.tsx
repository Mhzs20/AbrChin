import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
  TechnicalValue,
} from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { parchinLevelLabel } from "@/lib/parchin/catalog";
import { listCustomerParchinEnrollments } from "@/lib/parchin/service";

export const metadata: Metadata = {
  title: "پرچین‌های من | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "فعال",
  PAST_DUE: "سررسیدشده",
  SUSPENDED: "تعلیق‌شده",
  CANCELED: "لغوشده",
  ENDED: "پایان‌یافته",
};

export default async function AccountParchinPage() {
  const user = await requireCustomerPage();
  const enrollments = await listCustomerParchinEnrollments(user.id);

  return (
    <>
      <PageHeader
        title="پرچین‌های من"
        description="تعهد فعال، سهمیه درخواست، کارهای دوره‌ای و گزارش‌های هر سرور"
        actions={
          <Link href="/support" className="product-btn product-btn--quiet">
            مقایسه سطح‌ها
          </Link>
        }
      />
      <SectionCard title="قراردادهای فعال و قبلی">
        {enrollments.length === 0 ? (
          <EmptyState
            title="هنوز قرارداد پرچینی فعال نشده"
            description="پرچین پس از تحویل امن سرور به‌صورت خودکار فعال می‌شود."
            action={
              <Link href="/cloud-servers" className="product-btn product-btn--primary">
                انتخاب سرور
              </Link>
            }
          />
        ) : (
          <div className="parchin-account-grid">
            {enrollments.map((enrollment) => {
              const remaining = Math.max(
                0,
                enrollment.routineRequestLimit -
                  enrollment.routineRequestsUsed,
              );
              return (
                <article key={enrollment.id} className="parchin-account-card">
                  <header>
                    <div>
                      <span>{parchinLevelLabel(enrollment.level)}</span>
                      <h2>{enrollment.cloudInstance.name}</h2>
                    </div>
                    <StatusBadge
                      label={STATUS_LABELS[enrollment.status] ?? enrollment.status}
                      tone={enrollment.status === "ACTIVE" ? "success" : "warning"}
                    />
                  </header>
                  {enrollment.cloudInstance.ipv4 ? (
                    <TechnicalValue>{enrollment.cloudInstance.ipv4}</TechnicalValue>
                  ) : null}
                  <dl>
                    <div>
                      <dt>سهمیه روتین باقی‌مانده</dt>
                      <dd>{remaining.toLocaleString("fa-IR")}</dd>
                    </div>
                    <div>
                      <dt>کارهای باز</dt>
                      <dd>{enrollment._count.tasks.toLocaleString("fa-IR")}</dd>
                    </div>
                    <div>
                      <dt>گزارش‌های منتشرشده</dt>
                      <dd>{enrollment._count.reports.toLocaleString("fa-IR")}</dd>
                    </div>
                    <div>
                      <dt>درخواست‌های باز</dt>
                      <dd>{enrollment._count.supportRequests.toLocaleString("fa-IR")}</dd>
                    </div>
                  </dl>
                  <p>
                    دوره فعلی تا {enrollment.quotaPeriodEnd.toLocaleDateString("fa-IR")}
                  </p>
                  <footer>
                    <Link
                      href={`/account/parchin/${enrollment.id}`}
                      className="product-btn product-btn--primary"
                    >
                      جزئیات و گزارش‌ها
                    </Link>
                    <Link
                      href={`/account/support/requests/new?instanceId=${enrollment.cloudInstanceId}`}
                      className="product-btn product-btn--quiet"
                    >
                      ثبت درخواست
                    </Link>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </>
  );
}
