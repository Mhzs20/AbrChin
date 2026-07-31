import {
  InfrastructureProductKind,
  InfrastructureProvider,
  ParchinLevel,
} from "@prisma/client";

import { AuditActions, writeAuditLog } from "@/lib/audit/service";
import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { readRequestMeta } from "@/lib/session";

function bps(value: unknown, max: number): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new Error("invalid_bps");
  }
  return Number(value);
}

function money(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("invalid_money");
  }
  return BigInt(value);
}

export async function PATCH(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const admin = await requireAdminUser();
    const meta = await readRequestMeta(request);
    const body = (await request.json()) as {
      taxBps?: unknown;
      productMarkups?: Array<Record<string, unknown>>;
      parchin?: Array<Record<string, unknown>>;
    };
    const taxBps = bps(body.taxBps, 10_000);
    const products = (body.productMarkups ?? []).map((config) => {
      if (
        !Object.values(InfrastructureProvider).includes(
          config.provider as InfrastructureProvider,
        ) ||
        !Object.values(InfrastructureProductKind).includes(
          config.productKind as InfrastructureProductKind,
        ) ||
        config.apiVersion !== "v1"
      ) {
        throw new Error("invalid_product_pricing");
      }
      return {
        provider: config.provider as InfrastructureProvider,
        productKind: config.productKind as InfrastructureProductKind,
        apiVersion: "v1",
        markupBasisPoints: bps(config.markupBasisPoints, 100_000),
        enabled: config.enabled === true,
      };
    });
    const parchin = (body.parchin ?? []).map((config) => {
      if (
        !Object.values(ParchinLevel).includes(config.level as ParchinLevel)
      ) {
        throw new Error("invalid_parchin");
      }
      return {
        level: config.level as ParchinLevel,
        title:
          typeof config.title === "string" ? config.title.trim() : "",
        description:
          typeof config.description === "string"
            ? config.description.trim()
            : null,
        priceRial: money(config.priceRial),
        active: config.active === true,
      };
    });
    if (parchin.some((config) => !config.title)) {
      throw new Error("invalid_parchin");
    }
    if (
      !parchin.some(
        (config) =>
          config.level === ParchinLevel.PARCHIN_START && config.active,
      )
    ) {
      return jsonError("پرچین شروع باید فعال بماند.", 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.commercePricingConfig.upsert({
        where: { id: "default" },
        update: { taxBps, updatedById: admin.id },
        create: { id: "default", taxBps, updatedById: admin.id },
      });
      for (const config of products) {
        await tx.productPricingConfig.upsert({
          where: {
            provider_apiVersion_productKind: {
              provider: config.provider,
              apiVersion: config.apiVersion,
              productKind: config.productKind,
            },
          },
          update: {
            markupBasisPoints: config.markupBasisPoints,
            enabled: config.enabled,
            updatedById: admin.id,
          },
          create: {
            ...config,
            updatedById: admin.id,
          },
        });
      }
      for (const config of parchin) {
        await tx.parchinPricingConfig.update({
          where: { level: config.level },
          data: {
            title: config.title,
            description: config.description,
            priceRial: config.priceRial,
            active: config.active,
            updatedById: admin.id,
          },
        });
      }
      await writeAuditLog(
        {
          actorUserId: admin.id,
          action: AuditActions.PLAN_UPDATE,
          entityType: "commerce_pricing",
          entityId: "default",
          afterData: {
            taxBps,
            products,
            parchin: parchin.map((item) => ({
              ...item,
              priceRial: item.priceRial.toString(),
            })),
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        tx,
      );
    });
    return jsonOk({ ok: true });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (
      error instanceof Error &&
      ["invalid_bps", "invalid_money", "invalid_product_pricing", "invalid_parchin"].includes(
        error.message,
      )
    ) {
      return jsonError("تنظیم مالی معتبر نیست.", 400);
    }
    return jsonError("ذخیره تنظیمات مالی ممکن نیست.", 500);
  }
}
