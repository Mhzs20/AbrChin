import { CouponScope, CouponType } from "@prisma/client";

import { adminApiError, requireAdminUser } from "@/lib/admin/auth";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk, rejectCrossOrigin } from "@/lib/http";
import { normalizeCouponCode } from "@/lib/coupons/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdminUser();
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { id: true, mobile: true, displayName: true } },
      },
    });
    return jsonOk({
      coupons: coupons.map((coupon) => ({
        ...coupon,
        minDepositRial: coupon.minDepositRial?.toString() ?? null,
        bonusRial: coupon.bonusRial?.toString() ?? null,
      })),
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    return jsonError("خواندن کدهای تخفیف ممکن نیست.", 500);
  }
}

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;
  try {
    const admin = await requireAdminUser();
    const body = (await request.json()) as Record<string, unknown>;
    const code = normalizeCouponCode(body.code);
    const type =
      body.type === "SERVER_PURCHASE" || body.type === "WALLET_BONUS"
        ? (body.type as CouponType)
        : null;
    const scope =
      body.scope === "USER" || body.scope === "PUBLIC"
        ? (body.scope as CouponScope)
        : CouponScope.PUBLIC;
    if (!code || !type) {
      return jsonError("کد یا نوع تخفیف معتبر نیست.", 400);
    }
    if (scope === CouponScope.PUBLIC && !(body.expiresAt || body.maxRedemptions)) {
      return jsonError("کد عمومی باید تاریخ انقضا یا سقف مصرف داشته باشد.", 400);
    }
    if (scope === CouponScope.USER && typeof body.userId !== "string") {
      return jsonError("کد مخصوص کاربر به شناسه کاربر نیاز دارد.", 400);
    }

    const data =
      type === CouponType.SERVER_PURCHASE
        ? {
            discountBps: Number(body.discountBps),
            termMonths:
              body.termMonths === 1 ||
              body.termMonths === 3 ||
              body.termMonths === 6 ||
              body.termMonths === 12
                ? Number(body.termMonths)
                : null,
            minDepositRial: null as bigint | null,
            bonusRial: null as bigint | null,
          }
        : {
            discountBps: null as number | null,
            termMonths: null as number | null,
            minDepositRial:
              typeof body.minDepositRial === "string"
                ? BigInt(body.minDepositRial)
                : null,
            bonusRial:
              typeof body.bonusRial === "string" ? BigInt(body.bonusRial) : null,
          };

    if (
      type === CouponType.SERVER_PURCHASE &&
      (!Number.isInteger(data.discountBps) ||
        data.discountBps! < 0 ||
        data.discountBps! > 10_000 ||
        data.termMonths == null)
    ) {
      return jsonError("درصد و مدت کد خرید سرور معتبر نیست.", 400);
    }
    if (
      type === CouponType.WALLET_BONUS &&
      (data.minDepositRial == null ||
        data.bonusRial == null ||
        data.minDepositRial <= 0n ||
        data.bonusRial <= 0n)
    ) {
      return jsonError("مبالغ افزایش اعتبار معتبر نیست.", 400);
    }

    const coupon = await prisma.coupon.create({
      data: {
        code,
        type,
        scope,
        userId: scope === CouponScope.USER ? String(body.userId) : null,
        discountBps: data.discountBps,
        termMonths: data.termMonths,
        minDepositRial: data.minDepositRial,
        bonusRial: data.bonusRial,
        expiresAt:
          typeof body.expiresAt === "string" && body.expiresAt
            ? new Date(body.expiresAt)
            : null,
        maxRedemptions:
          scope === CouponScope.USER
            ? 1
            : Number.isInteger(body.maxRedemptions)
              ? Number(body.maxRedemptions)
              : null,
        active: body.active !== false,
        createdById: admin.id,
      },
    });
    return jsonOk({
      coupon: {
        ...coupon,
        minDepositRial: coupon.minDepositRial?.toString() ?? null,
        bonusRial: coupon.bonusRial?.toString() ?? null,
      },
    });
  } catch (error) {
    const adminError = adminApiError(error);
    if (adminError) return jsonError(adminError.message, adminError.status);
    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      return jsonError("این کد قبلاً ثبت شده است.", 409);
    }
    return jsonError("ساخت کد تخفیف ممکن نیست.", 500);
  }
}
