import type { ProviderCatalog, ProviderInstance } from "@/lib/infrastructure/types";

type UnknownRecord = Record<string, unknown>;

type ParsPackErrorBody = {
  error?: unknown;
  code?: unknown;
  message?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(asString).filter(Boolean);
  return items.length > 0 ? items : [];
}

function nestedCode(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return asString(value);
  if (!isRecord(value)) return "";
  return (
    asString(value.slug) ||
    asString(value.code) ||
    asString(value.id) ||
    asString(value.name)
  );
}

function listFromEnvelope(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) throw new Error("ParsPack response is missing a collection");
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) {
    for (const key of keys) {
      if (Array.isArray(payload.data[key])) return payload.data[key] as unknown[];
    }
  }
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  throw new Error("ParsPack response is missing a collection");
}

function unwrapVm(payload: unknown): UnknownRecord {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.vm)) return payload.vm;
  if (isRecord(payload.data) && isRecord(payload.data.vm)) return payload.data.vm;
  if (isRecord(payload.data)) return payload.data;
  return payload;
}

function findPublicIpv4(raw: UnknownRecord): string | null {
  for (const key of ["ipv4_address", "ipv4", "ip"]) {
    const value = asString(raw[key]);
    if (value) return value;
  }

  if (!isRecord(raw.networks) || !Array.isArray(raw.networks.v4)) return null;
  const networks = raw.networks.v4.filter(isRecord);
  const publicNetwork = networks.find((network) => asString(network.type) === "public");
  const fallback = networks[0];
  return (
    asString(publicNetwork?.ip_address) ||
    asString(publicNetwork?.ip) ||
    asString(fallback?.ip_address) ||
    asString(fallback?.ip) ||
    null
  );
}

export function parseParsPackVm(payload: unknown): ProviderInstance {
  const raw = unwrapVm(payload);
  const id = asString(raw.id);
  if (!id) throw new Error("ParsPack VM response is missing id");

  return {
    id,
    name: asString(raw.name) || "vm",
    region: nestedCode(raw.region),
    size: nestedCode(raw.size) || asString(raw.size_slug),
    image: nestedCode(raw.image),
    ipv4: findPublicIpv4(raw),
    status: asString(raw.status) || "unknown",
  };
}

export function parseVmList(payload: unknown): ProviderInstance[] {
  return listFromEnvelope(payload, ["vms"]).map((item) => parseParsPackVm(item));
}

export function parseParsPackNextPage(payload: unknown): number | null {
  if (!isRecord(payload) || !isRecord(payload.links) || !isRecord(payload.links.pages)) {
    return null;
  }
  const next = asString(payload.links.pages.next);
  if (!next) return null;
  try {
    const parsed = new URL(next, "https://parspack.invalid");
    const page = Number.parseInt(parsed.searchParams.get("page") ?? "", 10);
    return Number.isInteger(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

export function parseParsPackRegions(payload: unknown): ProviderCatalog["regions"] {
  return listFromEnvelope(payload, ["regions"])
    .filter(isRecord)
    .map((item) => ({
      code: asString(item.slug) || asString(item.code),
      name: asString(item.name) || asString(item.slug) || asString(item.code),
      available: asBoolean(item.available),
      sizeCodes: asStringArray(item.sizes),
      features: asStringArray(item.features),
    }))
    .filter((item) => item.code.length > 0);
}

export function parseParsPackSizes(payload: unknown): ProviderCatalog["sizes"] {
  return listFromEnvelope(payload, ["sizes"])
    .filter(isRecord)
    .map((item) => {
      const regionCodes = asStringArray(item.regions);
      return {
        code: asString(item.slug) || asString(item.code),
        name:
          asString(item.description) ||
          asString(item.name) ||
          asString(item.slug) ||
          asString(item.code),
        regionCode: regionCodes?.length === 1 ? regionCodes[0] : undefined,
        regionCodes,
        available: asBoolean(item.available),
        vcpu: asNumber(item.vcpus),
        memoryMb: asNumber(item.memory),
        diskGb: asNumber(item.disk),
        priceHourly: asNumber(item.price_hourly),
        priceMonthly: asNumber(item.price_monthly),
        transfer: asNumber(item.transfer),
      };
    })
    .filter((item) => item.code.length > 0);
}

export function parseParsPackImages(payload: unknown): ProviderCatalog["images"] {
  return listFromEnvelope(payload, ["images"])
    .filter(isRecord)
    .map((item) => ({
      code: asString(item.slug) || asString(item.id),
      name:
        asString(item.description) ||
        asString(item.name) ||
        asString(item.slug) ||
        asString(item.id),
      osFamily: asString(item.distribution) || undefined,
      regionCodes: asStringArray(item.regions),
      minDiskGb: asNumber(item.min_disk_size),
      status: asString(item.status) || undefined,
    }))
    .filter((item) => item.code.length > 0);
}

function errorText(body?: ParsPackErrorBody): string {
  if (!body) return "";
  const parts = [body.code, body.error, body.message].map((value) => {
    if (typeof value === "string") return value;
    if (isRecord(value)) {
      return [value.code, value.message].map(asString).filter(Boolean).join(" ");
    }
    return "";
  });
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function mapProviderHttpError(status: number, body?: ParsPackErrorBody): string {
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status === 402) return "provider_insufficient_balance";
  if (status === 404) return "provider_not_found";
  if (status === 408 || status === 423 || status === 429 || status >= 500) {
    return "provider_unavailable";
  }

  const text = errorText(body);
  if (text.includes("insufficient") || text.includes("balance") || text.includes("credit")) {
    return "provider_insufficient_balance";
  }
  return "provider_invalid_response";
}

export function sanitizeProviderResponse(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {};
  const record = isRecord(body.vm) ? body.vm : body;
  const safe: Record<string, unknown> = {};
  for (const key of [
    "id",
    "name",
    "status",
    "region",
    "size",
    "size_slug",
    "image",
    "code",
    "error",
    "message",
  ]) {
    if (key in record) safe[key] = record[key];
  }
  return safe;
}
