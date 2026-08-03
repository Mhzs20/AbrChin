import { normalizeArvanV1BaseUrl } from "@/lib/infrastructure/arvan/v1-adapter";

type UnknownRecord = Record<string, unknown>;

export type ArvanConnectionCheckCode =
  | "healthy"
  | "invalid_api_key"
  | "forbidden"
  | "rate_limited"
  | "timeout"
  | "invalid_payload"
  | "network_error"
  | "provider_error";

export type ArvanConnectionCheckResult = {
  ok: boolean;
  code: ArvanConnectionCheckCode;
  message: string;
  providerRequestId: string | null;
};

type ArvanConnectionCheckInput = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function regionCollection(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;
  if (Array.isArray(payload.regions)) return payload.regions;
  if (Array.isArray(payload.data)) return payload.data;
  if (!isRecord(payload.data)) return null;
  if (Array.isArray(payload.data.regions)) return payload.data.regions;
  if (Array.isArray(payload.data.items)) return payload.data.items;
  return null;
}

function isRegionIdentity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["id", "code", "slug", "name"].some((key) => {
    const identity = value[key];
    return (typeof identity === "string" && identity.trim().length > 0) ||
      (typeof identity === "number" && Number.isFinite(identity));
  });
}

function result(
  code: ArvanConnectionCheckCode,
  message: string,
  providerRequestId: string | null = null,
): ArvanConnectionCheckResult {
  return { ok: code === "healthy", code, message, providerRequestId };
}

export async function checkArvanAuthenticatedConnection(
  input: ArvanConnectionCheckInput,
): Promise<ArvanConnectionCheckResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    return result("invalid_api_key", "کلید دسترسی آروان تنظیم نشده است.");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.max(input.timeoutMs ?? 15_000, 1);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      `${normalizeArvanV1BaseUrl(input.baseUrl)}/regions`,
      {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Apikey ${apiKey}`,
        },
      },
    );
    const providerRequestId =
      response.headers.get("x-request-id") ??
      response.headers.get("x-correlation-id") ??
      response.headers.get("request-id");

    if (response.status === 401) {
      return result(
        "invalid_api_key",
        "کلید دسترسی آروان پذیرفته نشد.",
        providerRequestId,
      );
    }
    if (response.status === 403) {
      return result(
        "forbidden",
        "کلید آروان مجوز خواندن این Endpoint را ندارد.",
        providerRequestId,
      );
    }
    if (response.status === 429) {
      return result(
        "rate_limited",
        "آروان تعداد درخواست‌ها را موقتاً محدود کرده است.",
        providerRequestId,
      );
    }
    if (!response.ok) {
      return result(
        "provider_error",
        "Endpoint خواندنی آروان پاسخ موفق نداد.",
        providerRequestId,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return result(
        "invalid_payload",
        "پاسخ آروان JSON معتبر نیست.",
        providerRequestId,
      );
    }
    const regions = regionCollection(payload);
    if (!regions || regions.length === 0 || !regions.every(isRegionIdentity)) {
      return result(
        "invalid_payload",
        "ساختار پاسخ Region آروان معتبر نیست.",
        providerRequestId,
      );
    }
    return result(
      "healthy",
      "اتصال احرازشده و خواندنی آروان با موفقیت بررسی شد.",
      providerRequestId,
    );
  } catch (error) {
    const isAbort =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    return isAbort
      ? result("timeout", "زمان پاسخ Endpoint خواندنی آروان تمام شد.")
      : result("network_error", "اتصال شبکه به Endpoint خواندنی آروان برقرار نشد.");
  } finally {
    clearTimeout(timer);
  }
}
