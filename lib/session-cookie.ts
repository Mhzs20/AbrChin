export const SESSION_COOKIE_NAME = "abrchin_session";

export function sessionCookieOptions(maxAgeSeconds: number, isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
