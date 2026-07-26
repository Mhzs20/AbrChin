import { NextResponse } from "next/server";

import { getClientIp } from "@/lib/client-ip";
import { isSameOriginRequest } from "@/lib/request-origin";

export { getClientIp };

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: message, ...extra },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function rejectCrossOrigin(request: Request) {
  if (isSameOriginRequest(request)) {
    return null;
  }
  return jsonError("درخواست از مبدأ غیرمجاز رد شد.", 403);
}
