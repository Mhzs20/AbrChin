import { generateOtpCode, hashWithSecret, safeEqualHex } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import {
  createEmailProvider,
  EmailDeliveryError,
  type EmailProvider,
} from "@/lib/email";
import { assertServerSecrets, getEnv } from "@/lib/env";
import {
  OTP_MAX_ATTEMPTS,
  canAttemptOtp,
  otpFailureMessage,
  secondsUntilResend,
} from "@/lib/otp-rules";
import { WalletError } from "@/lib/wallet/errors";

const RESEND_COOLDOWN_SECONDS = 60;

export type EmailVerificationRequestResult =
  | { ok: true; resendAvailableIn: number; email: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

export type EmailVerificationVerifyResult =
  | { ok: true; alreadyVerified?: boolean }
  | { ok: false; error: string; code?: "email_changed" | "consumed" | "invalid" };

function verificationEmailCopy(code: string) {
  return {
    subject: "کد تأیید ایمیل ابرچین",
    text: `کد تأیید ایمیل ابرچین شما: ${code}\n\nاین کد برای مدت کوتاهی معتبر است. اگر این درخواست را نفرستاده‌اید، نادیده بگیرید.`,
    html: `<p>کد تأیید ایمیل ابرچین شما:</p><p style="font-size:24px;letter-spacing:4px;font-weight:700">${code}</p><p>این کد برای مدت کوتاهی معتبر است.</p>`,
  };
}

function advisoryLockKey(userId: string, email: string) {
  return `email-verify:${userId}:${email}`;
}

/**
 * Request / resend email verification.
 * Serialized per (userId + current normalized email) via PostgreSQL advisory lock
 * so concurrent requests cannot both pass cooldown and deliver two codes.
 */
export async function requestEmailVerification(input: {
  userId: string;
  ip?: string | null;
  emailProvider?: EmailProvider;
}): Promise<EmailVerificationRequestResult> {
  const env = assertServerSecrets();
  const code = generateOtpCode();
  const codeHash = hashWithSecret(code, env.sessionSecret);
  const ttl = getEnv().emailVerificationTtlSeconds;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const reserved = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new WalletError("not_found", "کاربر پیدا نشد.");
    if (!user.email) {
      return {
        ok: false as const,
        error: "ابتدا ایمیل را در پروفایل ذخیره کن.",
      };
    }
    if (user.emailVerifiedAt) {
      return {
        ok: false as const,
        error: "ایمیل قبلاً تأیید شده است.",
      };
    }

    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${advisoryLockKey(user.id, user.email)}, 0)
      )::text AS locked
    `;

    // Re-read under lock — email / verified state may have changed.
    const lockedUser = await tx.user.findUnique({ where: { id: input.userId } });
    if (!lockedUser?.email) {
      return {
        ok: false as const,
        error: "ابتدا ایمیل را در پروفایل ذخیره کن.",
      };
    }
    if (lockedUser.emailVerifiedAt) {
      return {
        ok: false as const,
        error: "ایمیل قبلاً تأیید شده است.",
      };
    }

    const recent = await tx.emailVerificationChallenge.findFirst({
      where: {
        userId: lockedUser.id,
        email: lockedUser.email,
        consumedAt: null,
      },
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

    const challenge = await tx.emailVerificationChallenge.create({
      data: {
        userId: lockedUser.id,
        email: lockedUser.email,
        codeHash,
        expiresAt,
      },
    });

    // Invalidate older unconsumed challenges for this user (any email).
    await tx.emailVerificationChallenge.deleteMany({
      where: {
        userId: lockedUser.id,
        consumedAt: null,
        id: { not: challenge.id },
      },
    });

    return {
      ok: true as const,
      challenge,
      email: lockedUser.email,
    };
  });

  if (!reserved.ok) {
    return {
      ok: false,
      error: reserved.error,
      retryAfterSeconds: reserved.retryAfterSeconds,
    };
  }

  let provider: EmailProvider;
  try {
    provider = input.emailProvider ?? createEmailProvider();
  } catch (error) {
    await prisma.emailVerificationChallenge
      .delete({ where: { id: reserved.challenge.id } })
      .catch(() => undefined);
    if (error instanceof EmailDeliveryError) {
      return {
        ok: false,
        error: "ارسال ایمیل پیکربندی نشده است. با پشتیبانی ابرچین تماس بگیرید.",
      };
    }
    throw error;
  }

  try {
    const copy = verificationEmailCopy(code);
    await provider.send({
      to: reserved.email,
      subject: copy.subject,
      text: copy.text,
      html: copy.html,
    });
  } catch (error) {
    await prisma.emailVerificationChallenge
      .delete({ where: { id: reserved.challenge.id } })
      .catch(() => undefined);
    if (error instanceof EmailDeliveryError) {
      return {
        ok: false,
        error: "ارسال ایمیل ممکن نشد. کمی بعد دوباره تلاش کن.",
      };
    }
    throw error;
  }

  return {
    ok: true,
    resendAvailableIn: RESEND_COOLDOWN_SECONDS,
    email: reserved.email,
  };
}

/**
 * Verify an email code atomically.
 *
 * Invariant: a verification code may verify ONLY the exact email it was issued
 * for, and only if that email is still the user's CURRENT email at commit time.
 * Concurrent profile email changes cannot attach verification to a new address.
 */
export async function verifyEmailVerificationCode(input: {
  userId: string;
  code: string;
}): Promise<EmailVerificationVerifyResult> {
  const env = assertServerSecrets();
  const code = input.code.trim().replace(/[۰-۹]/g, (d) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
  );
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "کد تأیید باید ۶ رقم باشد.", code: "invalid" };
  }

  const expectedHash = hashWithSecret(code, env.sessionSecret);

  return prisma.$transaction(async (tx) => {
    // Serialize mutations on this user row.
    await tx.$queryRaw`
      SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE
    `;

    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user?.email) {
      return {
        ok: false as const,
        error: "ایمیل برای تأیید پیدا نشد.",
        code: "invalid" as const,
      };
    }

    // Already verified for current email → idempotent success without
    // treating any submitted (possibly consumed) code as newly valid.
    if (user.emailVerifiedAt) {
      return { ok: true as const, alreadyVerified: true };
    }

    const challenge = await tx.emailVerificationChallenge.findFirst({
      where: {
        userId: user.id,
        email: user.email,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) {
      return {
        ok: false as const,
        error: "کد تأیید معتبر نیست. لطفاً دوباره درخواست دهید.",
        code: "invalid" as const,
      };
    }

    const blocked = canAttemptOtp(challenge);
    if (blocked) {
      return {
        ok: false as const,
        error: otpFailureMessage(blocked),
        code: (blocked === "consumed" ? "consumed" : "invalid") as
          | "consumed"
          | "invalid",
      };
    }

    if (!safeEqualHex(expectedHash, challenge.codeHash)) {
      const updated = await tx.emailVerificationChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      if (updated.attempts >= OTP_MAX_ATTEMPTS) {
        return {
          ok: false as const,
          error: otpFailureMessage("max_attempts"),
          code: "invalid" as const,
        };
      }
      return {
        ok: false as const,
        error: otpFailureMessage("invalid"),
        code: "invalid" as const,
      };
    }

    // Atomically consume only if still unconsumed.
    const consumed = await tx.emailVerificationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) {
      return {
        ok: false as const,
        error: otpFailureMessage("consumed"),
        code: "consumed" as const,
      };
    }

    // Conditional final mutation: user id AND current email still equals
    // the challenge email. If a concurrent profile change won the race,
    // do not set emailVerifiedAt.
    const verified = await tx.user.updateMany({
      where: {
        id: user.id,
        email: challenge.email,
        emailVerifiedAt: null,
      },
      data: { emailVerifiedAt: new Date() },
    });

    if (verified.count === 0) {
      // Re-check: either email changed or another writer verified.
      const latest = await tx.user.findUnique({ where: { id: user.id } });
      if (latest?.emailVerifiedAt) {
        return { ok: true as const, alreadyVerified: true };
      }
      return {
        ok: false as const,
        error: "ایمیل تغییر کرده است. کد جدید درخواست کن.",
        code: "email_changed" as const,
      };
    }

    return { ok: true as const };
  });
}

export async function invalidateEmailChallengesForUser(userId: string) {
  await prisma.emailVerificationChallenge.deleteMany({
    where: { userId, consumedAt: null },
  });
}
