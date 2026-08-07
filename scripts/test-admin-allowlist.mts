/**
 * ADMIN_MOBILES is the live allowlist for admin authorization.
 * Isolated Postgres fixtures that create UserRole.ADMIN must also allowlist
 * that mobile, or assertAdminActorTx / requireAdmin will fail closed.
 */

export function allowAdminMobile(mobile: string): () => void {
  const prior = process.env.ADMIN_MOBILES;
  const mobiles = new Set(
    (prior ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  mobiles.add(mobile.trim());
  process.env.ADMIN_MOBILES = [...mobiles].join(",");
  return () => {
    if (prior === undefined) delete process.env.ADMIN_MOBILES;
    else process.env.ADMIN_MOBILES = prior;
  };
}

export function allowAdminMobiles(mobiles: string[]): () => void {
  const prior = process.env.ADMIN_MOBILES;
  const set = new Set(
    (prior ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  for (const mobile of mobiles) {
    if (mobile.trim()) set.add(mobile.trim());
  }
  process.env.ADMIN_MOBILES = [...set].join(",");
  return () => {
    if (prior === undefined) delete process.env.ADMIN_MOBILES;
    else process.env.ADMIN_MOBILES = prior;
  };
}
