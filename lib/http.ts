import { NextResponse } from "next/server";

import { isSameOriginRequest } from "@/lib/request-origin";

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

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export function rejectCrossOrigin(request: Request) {
  if (isSameOriginRequest(request)) {
    return null;
  }
  return jsonError("درخواست از مبدأ غیرمجاز رد شد.", 403);
}
