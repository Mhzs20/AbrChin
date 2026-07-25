export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export type OtpChallengeState = {
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
};

export type OtpValidationFailure =
  | "expired"
  | "consumed"
  | "max_attempts"
  | "invalid";

export function isOtpExpired(challenge: Pick<OtpChallengeState, "expiresAt">, now = new Date()) {
  return challenge.expiresAt.getTime() <= now.getTime();
}

export function canAttemptOtp(challenge: OtpChallengeState, now = new Date()): OtpValidationFailure | null {
  if (challenge.consumedAt) return "consumed";
  if (isOtpExpired(challenge, now)) return "expired";
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return "max_attempts";
  return null;
}

export function secondsUntilResend(lastCreatedAt: Date, now = new Date()): number {
  const elapsedMs = now.getTime() - lastCreatedAt.getTime();
  const remainingMs = OTP_RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function otpFailureMessage(reason: OtpValidationFailure): string {
  switch (reason) {
    case "expired":
      return "کد تأیید منقضی شده است. لطفاً دوباره درخواست دهید.";
    case "consumed":
      return "این کد قبلاً استفاده شده است.";
    case "max_attempts":
      return "تعداد تلاش‌ها بیش از حد مجاز است. لطفاً کد جدید بگیرید.";
    default:
      return "کد تأیید نادرست است.";
  }
}
