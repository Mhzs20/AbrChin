import type { Metadata } from "next";
import Link from "next/link";

import { SupportRequestCreateForm } from "@/components/account/support-request-create-form";
import { Breadcrumb, PageHeader } from "@/components/product";
import { getUserServices } from "@/lib/account/queries";
import { requireCustomerPage } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "درخواست پشتیبانی جدید | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewSupportRequestPage() {
  const user = await requireCustomerPage();
  const instances = await getUserServices(user.id);

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
        }))}
      />
    </>
  );
}
