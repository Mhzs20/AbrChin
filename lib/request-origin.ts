/**
 * Reject cross-origin state-changing requests by comparing Origin (or Referer) to Host.
 * Same-origin browser fetches send a matching Origin; cross-site requests are blocked.
 */
function getRequestHost(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim().toLowerCase() || null;
  }

  const host = request.headers.get("host");
  return host?.toLowerCase() ?? null;
}

export function isSameOriginRequest(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  const expectedHost = getRequestHost(request);
  if (!expectedHost) {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  // Non-browser clients (curl, server-to-server) often omit Origin/Referer.
  // Allow only when Sec-Fetch-Site is absent or same-origin/none/same-site.
  if (!secFetchSite || secFetchSite === "same-origin" || secFetchSite === "none" || secFetchSite === "same-site") {
    return true;
  }

  return false;
}
