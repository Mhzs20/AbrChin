import { NextResponse } from "next/server";

/**
 * BigInt-safe JSON helpers for Admin accounting API responses.
 * NextResponse.json cannot serialize BigInt natively.
 */

export function serializeAccountingValue<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "bigint" ? current.toString() : current,
    ),
  ) as T;
}

export function accountingJsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(serializeAccountingValue(data), {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}
