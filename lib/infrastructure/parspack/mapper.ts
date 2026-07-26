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

export function mapProviderHttpError(status: number): string {
  if (status === 401) return "provider_auth_failed";
  if (status === 402 || status === 403) return "provider_insufficient_balance";
  if (status >= 500) return "provider_unavailable";
  return "provider_invalid_response";
}
