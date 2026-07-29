import { InfrastructureProvider } from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  formatBasisPointsPercent,
  parseMarkupPercentToBasisPoints,
} from "@/lib/pricing/provider-pricing";
import { readRequestMeta } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const body = (await request.json()) as { markupPercent?: unknown };
    let markupBasisPoints: number;
    try {
      markupBasisPoints = parseMarkupPercentToBasisPoints(body.markupPercent);
    } catch {
      return jsonError("درصد Markup باید عددی مثبت با حداکثر دو رقم اعشار باشد.", 400);
    }

    const before = await prisma.providerPricingConfig.findUnique({
      where: { provider: InfrastructureProvider.PARSPACK },
    });
    const pricing = await prisma.providerPricingConfig.upsert({
      where: { provider: InfrastructureProvider.PARSPACK },
      update: { markupBasisPoints, updatedById: admin.id },
      create: {
        id: "parspack",
        provider: InfrastructureProvider.PARSPACK,
        markupBasisPoints,
        updatedById: admin.id,
      },
    });
    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.PLAN_UPDATE,
      entityType: "provider_pricing_config",
      entityId: pricing.id,
      beforeData: { markupBasisPoints: before?.markupBasisPoints ?? 0 },
      afterData: { markupBasisPoints },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({
      pricing: {
        markupBasisPoints,
        markupPercent: formatBasisPointsPercent(markupBasisPoints),
        updatedAt: pricing.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    console.error("[admin/providers/markup]", error instanceof Error ? error.message : "unknown");
    return jsonError("ذخیره Markup ممکن نیست.", 500);
  }
}
