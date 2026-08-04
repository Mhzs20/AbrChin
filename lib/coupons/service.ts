import { CouponScope, CouponType, Prisma } from "@prisma/client";

import { isBillingTermMonths } from "@/lib/billing/lifecycle-policy";
import { prisma } from "@/lib/db";
import { WalletError } from "@/lib/wallet/errors";

export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return null;
  return code;
}

export async function resolveServerPurchaseCoupon(input: {
  code: string;
  userId?: string | null;
  termMonths: 1 | 3 | 6 | 12;
  now?: Date;
}) {
  const coupon = await prisma.coupon.findUnique({ where: { code: input.code } });
  if (!coupon || !coupon.active || coupon.type !== CouponType.SERVER_PURCHASE) {
    throw new WalletError("coupon_invalid", "کد تخفیف خرید سرور معتبر نیست.");
  }
  const now = input.now ?? new Date();
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
    throw new WalletError("coupon_expired", "کد تخفیف منقضی شده است.");
  }
  if (coupon.scope === CouponScope.USER) {
    if (!input.userId || coupon.userId !== input.userId) {
      throw new WalletError("coupon_not_for_user", "این کد برای حساب شما نیست.");
    }
  }
  if (
    coupon.maxRedemptions != null &&
    coupon.redemptionCount >= coupon.maxRedemptions
  ) {
    throw new WalletError("coupon_exhausted", "ظرفیت استفاده از این کد تمام شده است.");
  }
  if (coupon.scope === CouponScope.USER || coupon.maxRedemptions === 1) {
    const existing = input.userId
      ? await prisma.couponRedemption.findFirst({
          where: { couponId: coupon.id, userId: input.userId },
        })
      : null;
    if (existing) {
      throw new WalletError("coupon_already_used", "این کد قبلاً استفاده شده است.");
    }
  }
  if (
    coupon.termMonths != null &&
    isBillingTermMonths(coupon.termMonths) &&
    coupon.termMonths !== input.termMonths
  ) {
    throw new WalletError(
      "coupon_term_mismatch",
      `این کد فقط برای شارژ ${coupon.termMonths} ماهه است.`,
    );
  }
  if (
    coupon.discountBps == null ||
    !Number.isInteger(coupon.discountBps) ||
    coupon.discountBps < 0 ||
    coupon.discountBps > 10_000
  ) {
    throw new WalletError("coupon_invalid", "درصد تخفیف کد معتبر نیست.");
  }
  return coupon;
}

export async function resolveWalletBonusCoupon(input: {
  code: string;
  userId: string;
  depositRial: bigint;
  now?: Date;
}) {
  const coupon = await prisma.coupon.findUnique({ where: { code: input.code } });
  if (!coupon || !coupon.active || coupon.type !== CouponType.WALLET_BONUS) {
    throw new WalletError("coupon_invalid", "کد افزایش اعتبار معتبر نیست.");
  }
  const now = input.now ?? new Date();
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
    throw new WalletError("coupon_expired", "کد تخفیف منقضی شده است.");
  }
  if (coupon.scope === CouponScope.USER && coupon.userId !== input.userId) {
    throw new WalletError("coupon_not_for_user", "این کد برای حساب شما نیست.");
  }
  if (
    coupon.maxRedemptions != null &&
    coupon.redemptionCount >= coupon.maxRedemptions
  ) {
    throw new WalletError("coupon_exhausted", "ظرفیت استفاده از این کد تمام شده است.");
  }
  if (coupon.scope === CouponScope.USER || coupon.maxRedemptions === 1) {
    const existing = await prisma.couponRedemption.findFirst({
      where: { couponId: coupon.id, userId: input.userId },
    });
    if (existing) {
      throw new WalletError("coupon_already_used", "این کد قبلاً استفاده شده است.");
    }
  }
  if (
    coupon.minDepositRial == null ||
    coupon.bonusRial == null ||
    coupon.minDepositRial <= 0n ||
    coupon.bonusRial <= 0n
  ) {
    throw new WalletError("coupon_invalid", "شرایط افزایش اعتبار معتبر نیست.");
  }
  if (input.depositRial < coupon.minDepositRial) {
    throw new WalletError(
      "coupon_min_deposit",
      "مبلغ واریز برای دریافت شارژ اضافه کافی نیست.",
    );
  }
  return coupon;
}

export async function recordCouponRedemptionTx(
  tx: Prisma.TransactionClient,
  input: {
    couponId: string;
    userId: string;
    serviceOrderId?: string | null;
    walletTopUpId?: string | null;
    amountRial?: bigint;
    bonusRial?: bigint;
    idempotencyKey: string;
  },
) {
  const existing = await tx.couponRedemption.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;
  const created = await tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      userId: input.userId,
      serviceOrderId: input.serviceOrderId ?? null,
      walletTopUpId: input.walletTopUpId ?? null,
      amountRial: input.amountRial ?? 0n,
      bonusRial: input.bonusRial ?? 0n,
      idempotencyKey: input.idempotencyKey,
    },
  });
  await tx.coupon.update({
    where: { id: input.couponId },
    data: { redemptionCount: { increment: 1 } },
  });
  return created;
}
