type ParsPackVm = {
  id?: string | number;
  name?: string;
  region?: string;
  size?: string;
  image?: string;
  ipv4?: string | null;
  ip?: string | null;
  status?: string;
};

type ParsPackListResponse<T> = {
  data?: T[];
  items?: T[];
};

type ParsPackErrorBody = {
  error?: string;
  code?: string;
  message?: string;
};

export function parseParsPackVm(raw: ParsPackVm) {
  const id = raw.id != null ? String(raw.id) : "";
  if (!id) throw new Error("Missing VM id");
  return {
    id,
    name: raw.name ?? "vm",
    region: raw.region ?? "",
    size: raw.size ?? "",
    image: raw.image ?? "",
    ipv4: raw.ipv4 ?? raw.ip ?? null,
    status: raw.status ?? "unknown",
  };
}

export function parseCatalogItems<T extends { code?: string; name?: string }>(
  payload: ParsPackListResponse<T> | T[] | null | undefined,
): Array<{ code: string; name: string }> {
  const list = Array.isArray(payload) ? payload : payload?.data ?? payload?.items ?? [];
  return list
    .map((item) => ({
      code: String(item.code ?? ""),
      name: String(item.name ?? item.code ?? ""),
    }))
    .filter((item) => item.code.length > 0);
}

export function parseVmList(payload: ParsPackListResponse<ParsPackVm> | ParsPackVm[] | null | undefined) {
  const list = Array.isArray(payload) ? payload : payload?.data ?? payload?.items ?? [];
  return list.map((item) => parseParsPackVm(item));
}

export function mapProviderHttpError(status: number, body?: ParsPackErrorBody): string {
  if (status === 401) return "provider_auth_failed";
  if (status === 402) return "provider_insufficient_balance";
  if (status === 403) return "provider_auth_failed";
  if (status === 404) return "provider_not_found";
  if (status === 422) return "provider_invalid_response";
  if (status === 429) return "provider_unavailable";
  if (status >= 500) return "provider_unavailable";
  const code = (body?.code ?? body?.error ?? "").toLowerCase();
  if (code.includes("insufficient") || code.includes("balance") || code.includes("credit")) {
    return "provider_insufficient_balance";
  }
  return "provider_invalid_response";
}

export function sanitizeProviderResponse(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["id", "name", "status", "region", "size", "image", "code", "error", "message"]) {
    if (key in record) safe[key] = record[key];
  }
  return safe;
}
