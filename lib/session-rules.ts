export function isSessionRecordValid(
  session: { revokedAt: Date | null; expiresAt: Date } | null,
  now = Date.now(),
): session is { revokedAt: Date | null; expiresAt: Date } {
  if (!session) return false;
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now) return false;
  return true;
}
