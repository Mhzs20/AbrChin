import {
  AdminNotificationType,
  OperationalIncidentSeverity,
  OperationalIncidentStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { recordOperationalIncident } from "@/lib/operations/incidents";
import { resolveStorefrontTierOffers } from "@/lib/storefront/assortment-service";
import {
  STOREFRONT_LOW_STOCK_THRESHOLD,
  STOREFRONT_TIERS,
  storefrontTierLabel,
} from "@/lib/storefront/tiers";

const OPERATION = "storefront_tier_low_stock";

export async function checkStorefrontLowStockAlerts() {
  const results: Array<{
    tier: string;
    availableCount: number;
    alerted: boolean;
    resolved: boolean;
  }> = [];

  for (const tier of STOREFRONT_TIERS) {
    const { availableCount } = await resolveStorefrontTierOffers(tier);
    const label = storefrontTierLabel(tier);
    const safeCode = `tier_${tier.toLowerCase()}_low`;

    if (availableCount < STOREFRONT_LOW_STOCK_THRESHOLD) {
      await recordOperationalIncident({
        provider: null,
        apiVersion: null,
        operation: OPERATION,
        safeCode,
        title: `چینش کم‌موجودی: ${label}`,
        safeMessage: `${label} فقط ${availableCount} پلن موجود دارد. از پنل ادمین سرورهای جدید انتخاب کنید.`,
        severity: OperationalIncidentSeverity.CRITICAL,
        notificationType: AdminNotificationType.STOREFRONT_ASSORTMENT_LOW,
      });
      results.push({
        tier,
        availableCount,
        alerted: true,
        resolved: false,
      });
      continue;
    }

    const update = await prisma.operationalIncident.updateMany({
      where: {
        provider: null,
        operation: OPERATION,
        safeCode,
        status: OperationalIncidentStatus.OPEN,
      },
      data: {
        status: OperationalIncidentStatus.RESOLVED,
        resolvedAt: new Date(),
        resolutionCode: "storefront_tier_recovered",
      },
    });
    results.push({
      tier,
      availableCount,
      alerted: false,
      resolved: update.count > 0,
    });
  }

  return results;
}
