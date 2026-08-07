/** Customer identity helpers — names + normalized email. */

const NAME_MIN = 1;
const NAME_MAX = 64;

/** Persian letters, Latin letters, spaces, ZWNJ, apostrophe, hyphen. */
const NAME_PATTERN =
  /^[\u0600-\u06FF\u200cA-Za-z][\u0600-\u06FF\u200cA-Za-z\s'\-]{0,62}$/u;

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeEmail(raw: unknown):
  | { ok: true; email: string }
  | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "ایمیل معتبر نیست." };
  }
  const email = raw.trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "ایمیل الزامی است." };
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "فرمت ایمیل معتبر نیست." };
  }
  return { ok: true, email };
}

export function validatePersonName(
  raw: unknown,
  fieldLabel: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: `${fieldLabel} معتبر نیست.` };
  }
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) {
    return { ok: false, error: `${fieldLabel} الزامی است.` };
  }
  if (value.length < NAME_MIN || value.length > NAME_MAX) {
    return {
      ok: false,
      error: `${fieldLabel} باید بین ${NAME_MIN} تا ${NAME_MAX} نویسه باشد.`,
    };
  }
  if (!NAME_PATTERN.test(value)) {
    return {
      ok: false,
      error: `${fieldLabel} فقط می‌تواند شامل حروف فارسی یا لاتین باشد.`,
    };
  }
  return { ok: true, value };
}

export function deriveDisplayName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

export function isRegistrationComplete(user: {
  registrationCompletedAt: Date | null;
  role: string;
}) {
  if (user.role === "ADMIN") return true;
  return user.registrationCompletedAt != null;
}
