import type { Metadata } from "next";
import Link from "next/link";

import { SupportRequestCreateForm } from "@/components/account/support-request-create-form";
import { Breadcrumb, PageHeader } from "@/components/product";
import { getUserServices } from "@/lib/account/queries";
import { requireCustomerPage } from "@/lib/auth/guards";
import { parchinLevelLabel } from "@/lib/parchin/catalog";

export const metadata: Metadata = {
  title: "درخواست پشتیبانی جدید | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewSupportRequestPage({
  searchParams,
}: {
  searchParams: Promise<{
    instanceId?: string;
    orderId?: string;
    intent?: string;
    kind?: string;
  }>;
}) {
  const user = await requireCustomerPage();
  const [{ instanceId, orderId, intent, kind }, instances] = await Promise.all([
    searchParams,
    getUserServices(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="درخواست پشتیبانی جدید"
        description="موضوع را با جزئیات بنویس؛ در صورت امکان سرویس مرتبط را انتخاب کن."
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "پشتیبانی", href: "/account/support" },
              { label: "درخواست جدید" },
            ]}
          />
        }
        actions={
          <Link href="/account/support" className="product-btn product-btn--quiet">
            بازگشت
          </Link>
        }
      />
      <SupportRequestCreateForm
        instances={instances.map((item) => ({
          id: item.id,
          name: item.name,
          ipv4: item.ipv4,
          parchinLevel:
            item.parchinEnrollment?.status === "ACTIVE"
              ? item.parchinEnrollment.level
              : null,
          parchinTitle: item.parchinEnrollment?.status === "ACTIVE"
            ? parchinLevelLabel(item.parchinEnrollment.level)
            : null,
          routineRemaining: item.parchinEnrollment?.status === "ACTIVE"
            ? Math.max(
                0,
                item.parchinEnrollment.routineRequestLimit -
                  item.parchinEnrollment.routineRequestsUsed,
              )
            : null,
        }))}
        initialInstanceId={typeof instanceId === "string" ? instanceId : ""}
        initialOrderId={typeof orderId === "string" ? orderId : ""}
        initialCategory={intent === "cancel-before-delivery" ? "CHANGE" : undefined}
        initialKind={typeof kind === "string" ? kind : undefined}
        initialSubject={
          intent === "cancel-before-delivery"
            ? "درخواست لغو پیش از تحویل"
            : undefined
        }
        initialDescription={
          intent === "cancel-before-delivery"
            ? "لطفاً پیش از هر عملیات بعدی، امکان لغو امن این سفارش و مبلغ قابل بازگشت به کیف پول را بررسی کنید."
            : undefined
        }
      />
    </>
  );
}
