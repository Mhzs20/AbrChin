import { generateSessionToken, hashWithSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertServerSecrets, getEnv } from "@/lib/env";
import { isSessionRecordValid } from "@/lib/session-rules";

function sessionMaxAgeSeconds() {
  return getEnv().sessionTtlDays * 24 * 60 * 60;
}

export async function createUserSession(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
) {
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

export { sessionMaxAgeSeconds };
