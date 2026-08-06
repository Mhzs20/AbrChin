import { getEnv } from "@/lib/env";
import {
  arvanRegionPresentation,
} from "@/lib/infrastructure/arvan/regions";
import { normalizeArvanV1BaseUrl } from "@/lib/infrastructure/arvan/v1-adapter";

type UnknownRecord = Record<string, unknown>;

const REGION_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type DiscoveredArvanRegion = {
  regionCode: string;
  displayName: string;
  providerLabel: string | null;
};

function normalizeDiscoveredRegionCode(value: string): string | null {
  const code = value.trim().toLowerCase();
  if (!code || code.length > 64 || !REGION_CODE_PATTERN.test(code)) {
    return null;
  }
  return code;
}

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

function asTrimmedString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractRegionCode(row: UnknownRecord): string | null {
  for (const key of ["code", "slug", "id", "region", "name"] as const) {
    const raw = asTrimmedString(row[key]);
    if (!raw) continue;
    const code = normalizeDiscoveredRegionCode(raw);
    if (code) return code;
  }
  return null;
}

function extractProviderLabel(row: UnknownRecord): string | null {
  for (const key of ["title", "label", "display_name", "displayName", "name"] as const) {
    const raw = asTrimmedString(row[key]);
    if (raw) return raw.slice(0, 120);
  }
  return null;
}

export function parseDiscoveredArvanRegions(
  payload: unknown,
): DiscoveredArvanRegion[] {
  const rows = regionCollection(payload);
  if (!rows || rows.length === 0) {
    throw new Error("provider_region_discovery_empty");
  }
  const seen = new Set<string>();
  const discovered: DiscoveredArvanRegion[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const regionCode = extractRegionCode(row);
    if (!regionCode || seen.has(regionCode)) continue;
    seen.add(regionCode);
    const providerLabel = extractProviderLabel(row);
    const presentation = arvanRegionPresentation(regionCode);
    const displayName =
      presentation.label !== "موقعیت ابری"
        ? presentation.label
        : providerLabel ?? regionCode;
    discovered.push({
      regionCode,
      displayName: displayName.slice(0, 120),
      providerLabel,
    });
  }
  if (discovered.length === 0) {
    throw new Error("provider_region_discovery_empty");
  }
  return discovered;
}

export async function fetchArvanRegionsFromProvider(input?: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<DiscoveredArvanRegion[]> {
  const env = getEnv();
  const apiKey = (input?.apiKey ?? env.arvanApiKey).trim();
  if (!apiKey) {
    throw new Error("provider_auth_failed");
  }
  const fetchImpl = input?.fetchImpl ?? fetch;
  const timeoutMs = Math.max(input?.timeoutMs ?? env.arvanTimeoutMs, 1);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${normalizeArvanV1BaseUrl(input?.baseUrl ?? env.arvanApiBaseUrl)}/regions`,
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
    if (response.status === 401 || response.status === 403) {
      throw new Error("provider_auth_failed");
    }
    if (!response.ok) {
      throw new Error("provider_region_discovery_failed");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("provider_region_discovery_invalid");
    }
    return parseDiscoveredArvanRegions(payload);
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new Error("provider_region_discovery_timeout");
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("provider_") ||
        error.message === "provider_auth_failed")
    ) {
      throw error;
    }
    throw new Error("provider_region_discovery_failed");
  } finally {
    clearTimeout(timer);
  }
}
