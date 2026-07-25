import { cookies } from "next/headers";

import { jsonOk, rejectCrossOrigin } from "@/lib/http";
import {
  buildClearedSessionCookie,
  getSessionTokenFromCookies,
  revokeSessionByToken,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectCrossOrigin(request);
  if (rejected) return rejected;

  try {
    const token = await getSessionTokenFromCookies();
    if (token) {
      await revokeSessionByToken(token);
    }
  } catch (error) {
    console.error("[auth/logout]", error instanceof Error ? error.message : "unknown");
  }

  const jar = await cookies();
  jar.set(buildClearedSessionCookie());

  return jsonOk({ ok: true });
}
