export function getClientIp(request: Request): string {
  const trustedHops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && Number.isFinite(trustedHops) && trustedHops > 0) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const index = Math.max(0, parts.length - trustedHops);
    return parts[index] || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}
