import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ServiceUpgradeQuotePanel } from "@/components/account/service-upgrade-panels";
import { PageHeader } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { getUpgradeQuoteForCustomer } from "@/lib/orders/upgrade-quote";
import { WalletError } from "@/lib/wallet/errors";

export const metadata: Metadata = {
  title: "پیش‌فاکتور ارتقا | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function UpgradeQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerPage();
  const { id } = await params;

  let quote;
  try {
    quote = await getUpgradeQuoteForCustomer({
      resourceChangeRequestId: id,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof WalletError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <PageHeader
        title="پیش‌فاکتور ارتقا"
        description="مبلغ قفل‌شده، تأثیر روی کیف پول و زمان اعمال را قبل از برداشت ببین."
      />
      <ServiceUpgradeQuotePanel quoteId={id} initialQuote={quote} />
    </>
  );
}
