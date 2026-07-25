/**
 * Reject cross-origin state-changing requests by comparing Origin (or Referer) to Host.
 * Same-origin browser fetches send a matching Origin; cross-site requests are blocked.
 */
export function isSameOriginRequest(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  const host = request.headers.get("host");
  if (!host) {
    return false;
  }

  const expectedHost = host.toLowerCase();
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
