import { NextResponse } from "next/server";
import type { PaymentGatewayProvider } from "@prisma/client";

import { getEnv } from "@/lib/env";
import { createProviderFor } from "@/lib/payments";
import { WalletError } from "@/lib/wallet/ledger";
import { finalizeTopUpFromCallback } from "@/lib/wallet/topup";

function readParam(
  source: URLSearchParams | Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (source instanceof URLSearchParams) {
      const value = source.get(key);
      if (value != null && value !== "") return value;
    } else {
      const value = source[key];
      if (typeof value === "string" && value !== "") return value;
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
  }
  return null;
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const body = await request.json();
      return typeof body === "object" && body ? (body as Record<string, unknown>) : {};
    }
    const form = await request.formData();
    const out: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      out[key] = typeof value === "string" ? value : String(value);
    }
    return out;
  } catch {
    return {};
  }
}

export async function handleProviderCallback(
  request: Request,
  expectedGateway: PaymentGatewayProvider,
) {
  const url = new URL(request.url);
  const env = getEnv();
  const body = request.method === "POST" ? await parseBody(request) : {};
  const provider = createProviderFor(expectedGateway);

  const merged: Record<string, string | null | undefined> = {};
  for (const [key, value] of url.searchParams.entries()) {
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" || typeof value === "number") {
      merged[key] = String(value);
    }
  }

  const normalized = provider.normalizeCallback(merged);
  const topUpId =
    readParam(url.searchParams, ["topUpId"]) ||
    readParam(body, ["topUpId"]) ||
    normalized.orderId ||
    "";
  const token = readParam(url.searchParams, ["token"]) || readParam(body, ["token"]) || "";

  const resultUrl = new URL("/account/wallet/result", env.paymentCallbackBaseUrl);

  try {
    if (!topUpId || !token) {
      resultUrl.searchParams.set("status", "failed");
      resultUrl.searchParams.set("reason", "invalid");
      return NextResponse.redirect(resultUrl);
    }

    // Runtime validation of identifiers (no raw callback dump to logs)
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(topUpId) || !/^[a-zA-Z0-9_-]{16,128}$/.test(token)) {
      resultUrl.searchParams.set("status", "failed");
      resultUrl.searchParams.set("reason", "invalid");
      return NextResponse.redirect(resultUrl);
    }

    const result = await finalizeTopUpFromCallback({
      expectedGateway,
      topUpId,
      token,
      authority: normalized.authority,
      statusHint: normalized.statusHint,
    });

    resultUrl.searchParams.set("topUpId", result.topUp.id);
    if (result.topUp.status === "SUCCEEDED") {
      resultUrl.searchParams.set("status", "success");
    } else if (result.topUp.status === "CANCELED") {
      resultUrl.searchParams.set("status", "canceled");
    } else {
      resultUrl.searchParams.set("status", "failed");
    }
    return NextResponse.redirect(resultUrl);
  } catch (error) {
    if (!(error instanceof WalletError)) {
      console.error(`[payments/${expectedGateway.toLowerCase()}/callback]`, "callback_failed");
    }
    resultUrl.searchParams.set("status", "failed");
    resultUrl.searchParams.set("reason", "error");
    return NextResponse.redirect(resultUrl);
  }
}
