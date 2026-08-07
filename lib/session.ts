import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";
import type { User } from "@prisma/client";

import { effectiveUserRole } from "@/lib/admin/eligibility";
import { getClientIp } from "@/lib/client-ip";
import { generateSessionToken, hashWithSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertServerSecrets, getEnv } from "@/lib/env";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";
import { isSessionRecordValid } from "@/lib/session-rules";

export type PublicUser = {
  id: string;
  mobile: string;
  displayName: string | null;
  role: User["role"];
  mobileVerifiedAt: string | null;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    mobile: user.mobile,
    displayName: user.displayName,
    // Live allowlist re-check: stale ADMIN DB role is not enough after revoke.
    role: effectiveUserRole(user),
    mobileVerifiedAt: user.mobileVerifiedAt?.toISOString() ?? null,
  };
}

function sessionMaxAgeSeconds() {
  return getEnv().sessionTtlDays * 24 * 60 * 60;
}

export async function createUserSession(userId: string, meta?: { ip?: string | null; userAgent?: string | null }) {
  const env = assertServerSecrets();
  const token = generateSessionToken();
  const tokenHash = hashWithSecret(token, env.sessionSecret);
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds() * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ipAddress: meta?.ip?.slice(0, 64) || null,
      userAgent: meta?.userAgent?.slice(0, 255) || null,
    },
  });

  return { token, expiresAt };
}

export async function revokeSessionByToken(token: string) {
  const env = assertServerSecrets();
  const tokenHash = hashWithSecret(token, env.sessionSecret);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function findValidSession(token: string) {
  const env = assertServerSecrets();
  const tokenHash = hashWithSecret(token, env.sessionSecret);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!isSessionRecordValid(session)) return null;
  if (session.user.accountStatus === "BLOCKED") return null;
  return session;
}

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
