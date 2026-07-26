import { OtpPurpose, UserRole } from "@prisma/client";

import { generateOtpCode, hashWithSecret, safeEqualHex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertServerSecrets, isAdminMobile } from "@/lib/env";
import { createThenDeliverOtpChallenge } from "@/lib/otp-delivery";
import {
  OTP_MAX_ATTEMPTS,
  canAttemptOtp,
  otpFailureMessage,
  secondsUntilResend,
} from "@/lib/otp-rules";
import { createSmsProvider } from "@/lib/sms";
import type { SmsProvider } from "@/lib/sms";
import { createUserSession, toPublicUser } from "@/lib/session";
import { ensureWalletForUser } from "@/lib/wallet/ensure-wallet";

export type RequestOtpResult =
  | { ok: true; resendAvailableIn: number }
  | { ok: false; error: string; retryAfterSeconds?: number };

export type VerifyOtpResult =
  | {
      ok: true;
      user: ReturnType<typeof toPublicUser>;
      sessionToken: string;
    }
  | { ok: false; error: string };

export async function requestLoginOtp(
  mobile: string,
  options?: { smsProvider?: SmsProvider },
): Promise<RequestOtpResult> {
  const env = assertServerSecrets();

  const recent = await prisma.otpChallenge.findFirst({
    where: { mobile, purpose: OtpPurpose.LOGIN, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (recent) {
    const wait = secondsUntilResend(recent.createdAt);
    if (wait > 0) {
      return {
        ok: false,
        error: `لطفاً ${wait} ثانیه دیگر برای ارسال مجدد صبر کنید.`,
        retryAfterSeconds: wait,
      };
    }
  }

  const sms = options?.smsProvider ?? createSmsProvider();
  const code = generateOtpCode();
  const codeHash = hashWithSecret(code, env.sessionSecret);
  const expiresAt = new Date(Date.now() + env.otpTtlSeconds * 1000);

  await createThenDeliverOtpChallenge(
    () =>
      prisma.otpChallenge.create({
        data: {
          mobile,
          codeHash,
          purpose: OtpPurpose.LOGIN,
          expiresAt,
        },
      }),
    async () => {
      await sms.sendOtp({ mobile, code, purpose: OtpPurpose.LOGIN });
    },
    async (challenge) => {
      await prisma.otpChallenge.delete({ where: { id: challenge.id } });
    },
  );

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

  const now = new Date();
  const adminRole = isAdminMobile(mobile) ? UserRole.ADMIN : null;
  const user = await prisma.user.upsert({
    where: { mobile },
    create: {
      mobile,
      mobileVerifiedAt: now,
      role: adminRole ?? UserRole.CUSTOMER,
    },
    update: {
      mobileVerifiedAt: now,
      ...(adminRole ? { role: adminRole } : {}),
    },
  });

  await ensureWalletForUser(user.id);
  const session = await createUserSession(user.id, meta);

  return {
    ok: true,
    user: toPublicUser(user),
    sessionToken: session.token,
  };
}
