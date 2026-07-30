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
    const body = (await request.json()) as {
      provider?: unknown;
      markupPercent?: unknown;
      enabled?: unknown;
    };
    const provider =
      body.provider === InfrastructureProvider.ARVAN ||
      body.provider === InfrastructureProvider.PARSPACK
        ? body.provider
        : null;
    if (!provider) return jsonError("Provider معتبر نیست.", 400);
    if (typeof body.enabled !== "boolean") {
      return jsonError("وضعیت Provider معتبر نیست.", 400);
    }
    let markupBasisPoints: number;
    try {
      markupBasisPoints = parseMarkupPercentToBasisPoints(body.markupPercent);
    } catch {
      return jsonError("درصد Markup باید عددی مثبت با حداکثر دو رقم اعشار باشد.", 400);
    }

    const before = await prisma.providerPricingConfig.findUnique({
      where: { provider },
    });
    const pricing = await prisma.providerPricingConfig.upsert({
      where: { provider },
      update: {
        markupBasisPoints,
        enabled: body.enabled,
        updatedById: admin.id,
      },
      create: {
        id: `${provider.toLowerCase()}-v1`,
        provider,
        apiVersion: "v1",
        sourceMoneyUnit:
          provider === InfrastructureProvider.ARVAN ? "IRR" : null,
        markupBasisPoints,
        enabled: body.enabled,
        updatedById: admin.id,
      },
    });
    await prisma.providerCatalogState.upsert({
      where: { provider },
      update: { enabled: body.enabled },
      create: {
        id: `${provider.toLowerCase()}-v1`,
        provider,
        apiVersion: "v1",
        enabled: body.enabled,
      },
    });
    await writeAuditLog({
      actorUserId: admin.id,
      action: AuditActions.PLAN_UPDATE,
      entityType: "provider_pricing_config",
      entityId: pricing.id,
      beforeData: { markupBasisPoints: before?.markupBasisPoints ?? 0 },
      afterData: { markupBasisPoints, enabled: body.enabled },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return jsonOk({
      pricing: {
        markupBasisPoints,
        enabled: body.enabled,
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
