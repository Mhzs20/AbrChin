import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

import { getClientIp } from "@/lib/client-ip";
import { getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";
import {
  findValidSession,
  sessionMaxAgeSeconds,
} from "@/lib/session-store";
import { toPublicUser, type PublicUser } from "@/lib/session-user";

export type { PublicUser } from "@/lib/session-user";
export { toPublicUser } from "@/lib/session-user";
export {
  createUserSession,
  findValidSession,
  revokeSessionByToken,
} from "@/lib/session-store";

export async function getSessionTokenFromCookies(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export function getSessionTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = await getSessionTokenFromCookies();
  if (!token) return null;
  const session = await findValidSession(token);
  if (!session) return null;
  return toPublicUser(session.user);
}

export async function requireCurrentUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthRequiredError();
  }
  return user;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export async function readRequestMeta(request?: Request) {
  if (request) {
    const ip = getClientIp(request);
    const userAgent = request.headers.get("user-agent");
    return { ip: ip === "unknown" ? null : ip, userAgent };
  }

  const h = await headers();
  // Mirror getClientIp hop trust when headers() is used outside a Request.
  const trustedHops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10);
  const forwarded = h.get("x-forwarded-for");
  let ip: string | null = h.get("x-real-ip");
  if (forwarded && Number.isFinite(trustedHops) && trustedHops > 0) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const index = Math.max(0, parts.length - trustedHops);
    ip = parts[index] || ip;
  } else if (!(Number.isFinite(trustedHops) && trustedHops > 0)) {
    // Untrusted clients must not dictate audit IP via spoofable XFF.
    ip = h.get("x-real-ip");
  }
  const userAgent = h.get("user-agent");
  return { ip, userAgent };
}

export function buildSessionCookie(token: string) {
  const env = getEnv();
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions(sessionMaxAgeSeconds(), env.isProduction),
  };
}

export function buildClearedSessionCookie() {
  const env = getEnv();
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(0, env.isProduction),
    expires: new Date(0),
  };
}
