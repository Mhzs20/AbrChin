import { InfrastructureProductKind } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ReadyServerQuoteButton } from "@/components/ready-server-quote-button";
import { PageHeader } from "@/components/product";
import { resolveParchinLevelLabel } from "@/lib/parchin/labels";
import { parchinLevelRank } from "@/lib/parchin/recommendation";
import { toParchinServiceContract } from "@/lib/parchin/service-contract";
import { getCatalogServerDeliveryOptions } from "@/lib/recommendation/quote-service";
import { listPublicStorefrontTiers } from "@/lib/storefront/assortment-service";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "تنظیم و پیش‌فاکتور سرور | ابرچین",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConfigureCloudServerPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const [{ planId }, { product }] = await Promise.all([params, searchParams]);
  const catalog = await listPublicStorefrontTiers();
  const offer = catalog.tiers
    .flatMap((tier) => tier.offers)
    .find((item) => item.id === planId && item.purchasable);

  if (!offer) redirect("/cloud-servers?selection=unavailable");

  const productPath =
    offer.productKind === "READY_INSTANT_SERVER"
      ? "ready-servers"
      : "cloud-servers";
  if (product && product !== productPath) {
    redirect("/cloud-servers?selection=unavailable");
  }
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
  const parchinOptions = (
    await prisma.parchinPricingConfig.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    })
  )
    .map(toParchinServiceContract)
    .filter(
      (contract) =>
        parchinLevelRank(contract.level) >= parchinLevelRank(offer.parchinLevel),
    );

  return (
    <>
      <PageHeader
        title="تنظیم سرور و دریافت پیش‌فاکتور"
        description="سیستم‌عامل، نام سرور و دوره را انتخاب کن؛ پیش‌فاکتور نهایی پیش از ورود برای ۶۰ دقیقه قفل می‌شود."
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
        parchinOptions={parchinOptions.map((contract) => ({
          level: contract.level,
          title: contract.title,
          subtitle: contract.subtitle,
          description: contract.description,
          monthlyPriceRial: contract.monthlyPriceRial,
          firstResponseTarget: contract.firstResponseTarget,
          routineRequestLimit: contract.operationalPolicy.routineRequestLimit,
        }))}
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
          parchinLevel: offer.parchinLevel,
          parchinSummary: offer.parchinSummary ?? null,
          salePriceRial: offer.salePriceRial,
          renewalPriceRial: offer.renewalPriceRial,
          instantDelivery: offer.instantDelivery,
        }}
      />
    </>
  );
}
