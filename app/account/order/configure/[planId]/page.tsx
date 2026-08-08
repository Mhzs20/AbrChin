import { InfrastructureProductKind } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ReadyServerQuoteButton } from "@/components/ready-server-quote-button";
import { PageHeader } from "@/components/product";
import { requireCustomerPage } from "@/lib/auth/guards";
import { resolveParchinLevelLabel } from "@/lib/parchin/labels";
import { getCatalogServerDeliveryOptions } from "@/lib/recommendation/quote-service";
import { listPublicStorefrontTiers } from "@/lib/storefront/assortment-service";

export const metadata: Metadata = {
  title: "تکمیل سفارش سرور | حساب من | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConfigureServerOrderPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  await requireCustomerPage();
  const { planId } = await params;
  const catalog = await listPublicStorefrontTiers();
  const offer = catalog.tiers
    .flatMap((tier) => tier.offers)
    .find((item) => item.id === planId && item.purchasable);

  if (!offer) {
    redirect("/cloud-servers?selection=unavailable");
  }

  const productPath =
    offer.productKind === "READY_INSTANT_SERVER"
      ? "ready-servers"
      : "cloud-servers";
  const parchinTitle =
    offer.parchinTitle ?? resolveParchinLevelLabel(offer.parchinLevel);
  let deliveryOptions;
  try {
    deliveryOptions = await getCatalogServerDeliveryOptions({
      planId: offer.id,
      expectedProductKind:
        offer.productKind === "READY_INSTANT_SERVER"
          ? InfrastructureProductKind.READY_INSTANT_SERVER
          : InfrastructureProductKind.CLOUD_SERVER,
    });
  } catch {
    redirect("/cloud-servers?selection=unavailable");
  }
  if (deliveryOptions.images.length === 0) {
    redirect("/cloud-servers?selection=unavailable");
  }

  return (
    <>
      <PageHeader
        title="تکمیل سفارش سرور"
        description="مشخصات سرور در سمت راست تکمیل می‌شود و خلاصه همان پلن را در سمت چپ می‌بینی."
        actions={
          <Link href="/cloud-servers" className="product-btn product-btn--quiet">
            تغییر پلن
          </Link>
        }
      />
      <ReadyServerQuoteButton
        planId={offer.id}
        productPath={productPath}
        standalone
        initialOptions={deliveryOptions}
        orderSummary={{
          title: offer.title,
          locationLabel: offer.locationLabel,
          vcpu: offer.vcpu,
          ramGb: offer.ramGb,
          storageGb: offer.storageGb,
          transferTb: offer.transferTb,
          diskTypeLabel: offer.diskTypeLabel ?? null,
          ipv4Available: offer.ipv4Available ?? null,
          ipv6Available: offer.ipv6Available ?? null,
          operatingSystemLabels: offer.operatingSystemLabels,
          parchinTitle,
          parchinSummary: offer.parchinSummary ?? null,
          salePriceRial: offer.salePriceRial,
          renewalPriceRial: offer.renewalPriceRial,
          instantDelivery: offer.instantDelivery,
        }}
      />
    </>
  );
}
