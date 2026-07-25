const LOCAL_MOBILE = /^09\d{9}$/;
const E164_IRAN_MOBILE = /^\+989\d{9}$/;

export type MobileNormalizeResult =
  | { ok: true; mobile: string }
  | { ok: false; error: string };

/**
 * Accepts Iranian mobiles as 09xxxxxxxxx or +989xxxxxxxxx
 * and normalizes to 09xxxxxxxxx.
 */
export function normalizeIranMobile(input: unknown): MobileNormalizeResult {
  if (typeof input !== "string") {
    return { ok: false, error: "شماره موبایل معتبر نیست." };
  }

  const trimmed = input.trim().replace(/[\s\-()]/g, "");
  const digits = trimmed.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

  let candidate = digits;
  if (candidate.startsWith("0098")) {
    candidate = `+${candidate.slice(2)}`;
  } else if (candidate.startsWith("98") && candidate.length === 12) {
    candidate = `+${candidate}`;
  }

  if (E164_IRAN_MOBILE.test(candidate)) {
    return { ok: true, mobile: `0${candidate.slice(3)}` };
  }

  if (LOCAL_MOBILE.test(candidate)) {
    return { ok: true, mobile: candidate };
  }

  return { ok: false, error: "شماره موبایل باید با فرمت ۰۹xxxxxxxxx باشد." };
}
