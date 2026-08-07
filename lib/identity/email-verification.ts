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

function verificationEmailCopy(code: string) {
  return {
    subject: "کد تأیید ایمیل ابرچین",
    text: `کد تأیید ایمیل ابرچین شما: ${code}\n\nاین کد برای مدت کوتاهی معتبر است. اگر این درخواست را نفرستاده‌اید، نادیده بگیرید.`,
    html: `<p>کد تأیید ایمیل ابرچین شما:</p><p style="font-size:24px;letter-spacing:4px;font-weight:700">${code}</p><p>این کد برای مدت کوتاهی معتبر است.</p>`,
  };
}

export async function requestEmailVerification(input: {
  userId: string;
  ip?: string | null;
  emailProvider?: EmailProvider;
}): Promise<EmailVerificationRequestResult> {
  const env = assertServerSecrets();
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new WalletError("not_found", "کاربر پیدا نشد.");
  if (!user.email) {
    return { ok: false, error: "ابتدا ایمیل را در پروفایل ذخیره کن." };
  }
  if (user.emailVerifiedAt) {
    return { ok: false, error: "ایمیل قبلاً تأیید شده است." };
  }

  const recent = await prisma.emailVerificationChallenge.findFirst({
    where: {
      userId: user.id,
      email: user.email,
      consumedAt: null,
    },
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

  const code = generateOtpCode();
  const codeHash = hashWithSecret(code, env.sessionSecret);
  const ttl = getEnv().emailVerificationTtlSeconds;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const challenge = await prisma.$transaction(async (tx) => {
    await tx.emailVerificationChallenge.deleteMany({
      where: {
        userId: user.id,
        consumedAt: null,
      },
    });
    return tx.emailVerificationChallenge.create({
      data: {
        userId: user.id,
        email: user.email!,
        codeHash,
        expiresAt,
      },
    });
  });

  let provider: EmailProvider;
  try {
    provider = input.emailProvider ?? createEmailProvider();
  } catch (error) {
    await prisma.emailVerificationChallenge
      .delete({ where: { id: challenge.id } })
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
      to: user.email,
      subject: copy.subject,
      text: copy.text,
      html: copy.html,
    });
  } catch (error) {
    await prisma.emailVerificationChallenge
      .delete({ where: { id: challenge.id } })
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
    email: user.email,
  };
}

export async function verifyEmailVerificationCode(input: {
  userId: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = assertServerSecrets();
  const code = input.code.trim().replace(/[۰-۹]/g, (d) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
  );
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: "کد تأیید باید ۶ رقم باشد." };
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user?.email) {
    return { ok: false, error: "ایمیل برای تأیید پیدا نشد." };
  }
  if (user.emailVerifiedAt) {
    return { ok: true };
  }

  const challenge = await prisma.emailVerificationChallenge.findFirst({
    where: {
      userId: user.id,
      email: user.email,
    },
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
  if (!safeEqualHex(expectedHash, challenge.codeHash)) {
    const updated = await prisma.emailVerificationChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= OTP_MAX_ATTEMPTS) {
      return { ok: false, error: otpFailureMessage("max_attempts") };
    }
    return { ok: false, error: otpFailureMessage("invalid") };
  }

  const consumed = await prisma.emailVerificationChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) {
    return { ok: false, error: otpFailureMessage("consumed") };
  }

  // Bind to current email — reject if email changed after code issue.
  if (challenge.email !== user.email) {
    return {
      ok: false,
      error: "ایمیل تغییر کرده است. کد جدید درخواست کن.",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
  });

  return { ok: true };
}

export async function invalidateEmailChallengesForUser(userId: string) {
  await prisma.emailVerificationChallenge.deleteMany({
    where: { userId, consumedAt: null },
  });
}
