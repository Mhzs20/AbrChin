import { OtpPurpose, UserRole } from "@prisma/client";

import { generateOtpCode, hashWithSecret, safeEqualHex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertServerSecrets, isAdminMobile } from "@/lib/env";
import {
  OTP_MAX_ATTEMPTS,
  canAttemptOtp,
  otpFailureMessage,
  secondsUntilResend,
} from "@/lib/otp-rules";
import { createSmsProvider } from "@/lib/sms";
import type { SmsProvider } from "@/lib/sms";
import type { PublicUser } from "@/lib/session";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

export type RequestOtpResult =
  | { ok: true; resendAvailableIn: number }
  | { ok: false; error: string; retryAfterSeconds?: number };

export type VerifyOtpResult =
  | {
      ok: true;
      user: PublicUser;
      sessionToken: string;
    }
  | { ok: false; error: string };

export async function requestLoginOtp(
  mobile: string,
  options?: { smsProvider?: SmsProvider },
): Promise<RequestOtpResult> {
  const env = assertServerSecrets();
  const sms = options?.smsProvider ?? createSmsProvider();
  const existingUser = await prisma.user.findUnique({
    where: { mobile },
    select: { accountStatus: true },
  });
  if (existingUser?.accountStatus === "BLOCKED") {
    return {
      ok: false,
      error: "این حساب مسدود است. برای رفع مسدودی با پشتیبانی ابرچین تماس بگیرید.",
    };
  }
  const code = generateOtpCode();
  const codeHash = hashWithSecret(code, env.sessionSecret);
  const expiresAt = new Date(Date.now() + env.otpTtlSeconds * 1000);

  // Serialize OTP issue per mobile so double-clicks / parallel requests cannot
  // both pass the resend cooldown and deliver two SMS back-to-back.
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`otp:${OtpPurpose.LOGIN}:${mobile}`}, 0)
      )::text AS locked
    `;

    const recent = await tx.otpChallenge.findFirst({
      where: { mobile, purpose: OtpPurpose.LOGIN, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (recent) {
      const wait = secondsUntilResend(recent.createdAt);
      if (wait > 0) {
        return {
          ok: false as const,
          error: `لطفاً ${wait} ثانیه دیگر برای ارسال مجدد صبر کنید.`,
          retryAfterSeconds: wait,
        };
      }
    }

    const challenge = await tx.otpChallenge.create({
      data: {
        mobile,
        codeHash,
        purpose: OtpPurpose.LOGIN,
        expiresAt,
      },
    });

    // Keep only the freshly reserved challenge consumable.
    await tx.otpChallenge.deleteMany({
      where: {
        mobile,
        purpose: OtpPurpose.LOGIN,
        consumedAt: null,
        id: { not: challenge.id },
      },
    });

    return { ok: true as const, challenge };
  });

  if (!reserved.ok) {
    return {
      ok: false,
      error: reserved.error,
      retryAfterSeconds: reserved.retryAfterSeconds,
    };
  }

  try {
    await sms.sendOtp({ mobile, code, purpose: OtpPurpose.LOGIN });
  } catch (error) {
    // Failed delivery must not leave a consumable OTP behind.
    try {
      await prisma.otpChallenge.delete({ where: { id: reserved.challenge.id } });
    } catch {
      // Prefer the original delivery error; cleanup failure is secondary.
    }
    throw error;
  }

  return { ok: true, resendAvailableIn: 60 };
}

export async function verifyLoginOtp(
  mobile: string,
  code: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<VerifyOtpResult> {
  const env = assertServerSecrets();

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "کد تأیید باید ۶ رقم باشد." };
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: { mobile, purpose: OtpPurpose.LOGIN },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    return { ok: false, error: "کد تأیید معتبر نیست. لطفاً دوباره درخواست دهید." };
  }

  const blocked = canAttemptOtp(challenge);
  if (blocked) {
    return { ok: false, error: otpFailureMessage(blocked) };
  }

  const expectedHash = hashWithSecret(code, env.sessionSecret);
  const matches = safeEqualHex(expectedHash, challenge.codeHash);

  if (!matches) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });

    if (updated.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, error: otpFailureMessage("max_attempts") };
    }

    return { ok: false, error: otpFailureMessage("invalid") };
  }

  const consumed = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  if (consumed.count === 0) {
    return { ok: false, error: otpFailureMessage("consumed") };
  }

  const existing = await prisma.user.findUnique({ where: { mobile } });
  if (existing?.accountStatus === "BLOCKED") {
    return {
      ok: false,
      error: "این حساب مسدود است. برای رفع مسدودی با پشتیبانی ابرچین تماس بگیرید.",
    };
  }

  const now = new Date();
  // ADMIN_MOBILES is the allowlist source of truth: promote when present,
  // demote on login when removed (stale ADMIN role must not persist forever).
  const nextRole = isAdminMobile(mobile) ? UserRole.ADMIN : UserRole.CUSTOMER;
  const user = await prisma.user.upsert({
    where: { mobile },
    create: {
      mobile,
      mobileVerifiedAt: now,
      role: nextRole,
      accountStatus: "ACTIVE",
    },
    update: {
      mobileVerifiedAt: now,
      role: nextRole,
    },
  });

  if (user.accountStatus === "BLOCKED") {
    return {
      ok: false,
      error: "این حساب مسدود است. برای رفع مسدودی با پشتیبانی ابرچین تماس بگیرید.",
    };
  }

  await ensureWalletForUser(user.id);
  // Lazy-load Next session helpers so OTP *request* paths (and their tests)
  // do not require `next/headers` at module evaluation time.
  const { createUserSession, toPublicUser } = await import("@/lib/session");
  const session = await createUserSession(user.id, meta);

  return {
    ok: true,
    user: toPublicUser(user),
    sessionToken: session.token,
  };
}
