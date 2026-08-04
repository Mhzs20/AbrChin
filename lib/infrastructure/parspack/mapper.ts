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

function asDecimalString(value: unknown): string | undefined {
  const raw = (() => {
    if (typeof value === "string") return value.trim();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return "";
    }
    // Above 2^32 a JavaScript number cannot distinguish every 6-decimal
    // provider amount. Reject that ambiguous representation rather than
    // silently changing money; string amounts have no such range limit.
    if (value >= 2 ** 32) return "";
    const candidate = value.toFixed(6);
    if (Number(candidate) !== value) return "";
    return candidate;
  })();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return undefined;
  const [whole, fraction] = raw.split(".");
  const normalizedWhole = BigInt(whole).toString();
  if (fraction == null) return normalizedWhole;
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  const parsed = asBoolean(value);
  if (parsed === undefined) {
    throw new Error("ParsPack response contains an invalid boolean");
  }
  return parsed;
}

function asStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("ParsPack response contains an invalid string array");
  }
  const items = value.map(asString).filter(Boolean);
  if (items.length !== value.length) {
    throw new Error("ParsPack response contains an invalid string array");
  }
  return items;
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
  if (!isRecord(payload) || payload.links == null) {
    return null;
  }
  if (!isRecord(payload.links)) {
    throw new Error("ParsPack response contains invalid pagination");
  }
  if (payload.links.pages == null) return null;
  if (!isRecord(payload.links.pages)) {
    throw new Error("ParsPack response contains invalid pagination");
  }
  const rawNext = payload.links.pages.next;
  if (rawNext == null || rawNext === "") return null;
  if (typeof rawNext !== "string") {
    throw new Error("ParsPack response contains invalid pagination");
  }
  try {
    const parsed = new URL(rawNext, "https://parspack.invalid");
    const rawPage = parsed.searchParams.get("page") ?? "";
    if (!/^\d+$/.test(rawPage)) {
      throw new Error("ParsPack response contains invalid pagination");
    }
    const page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page <= 0) {
      throw new Error("ParsPack response contains invalid pagination");
    }
    return page;
  } catch {
    throw new Error("ParsPack response contains invalid pagination");
  }
}

export function parseParsPackRegions(payload: unknown): ProviderCatalog["regions"] {
  const values = listFromEnvelope(payload, ["regions"]);
  if (values.some((item) => !isRecord(item))) {
    throw new Error("ParsPack response contains an invalid region");
  }
  const regions = (values as UnknownRecord[]).map((item) => ({
      code: asString(item.slug) || asString(item.code),
      name: asString(item.name) || asString(item.slug) || asString(item.code),
      available: asOptionalBoolean(item.available),
      sizeCodes: asStringArray(item.sizes),
      features: asStringArray(item.features),
    }));
  if (regions.some((item) => item.code.length === 0)) {
    throw new Error("ParsPack response contains an invalid region");
  }
  return regions;
}

export function parseParsPackSizes(payload: unknown): ProviderCatalog["sizes"] {
  const values = listFromEnvelope(payload, ["sizes"]);
  if (values.some((item) => !isRecord(item))) {
    throw new Error("ParsPack response contains an invalid size");
  }
  const sizes = (values as UnknownRecord[]).map((item) => {
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
        available: asOptionalBoolean(item.available),
        vcpu: asNumber(item.vcpus),
        memoryMb: asNumber(item.memory),
        diskGb: asNumber(item.disk),
        priceHourly: asDecimalString(item.price_hourly),
        priceMonthly: asDecimalString(item.price_monthly),
        transfer: asNumber(item.transfer),
        rawUpdatedAt: asString(item.updated_at) || undefined,
      };
    });
  if (sizes.some((item) => item.code.length === 0)) {
    throw new Error("ParsPack response contains an invalid size");
  }
  return sizes;
}

export function parseParsPackImages(payload: unknown): ProviderCatalog["images"] {
  const values = listFromEnvelope(payload, ["images"]);
  if (values.some((item) => !isRecord(item))) {
    throw new Error("ParsPack response contains an invalid image");
  }
  const images = (values as UnknownRecord[]).map((item) => ({
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
    }));
  if (images.some((item) => item.code.length === 0)) {
    throw new Error("ParsPack response contains an invalid image");
  }
  return images;
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
