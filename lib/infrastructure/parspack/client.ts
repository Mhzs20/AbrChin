import { InfrastructureProvider } from "@prisma/client";

import { InfrastructureError } from "@/lib/infrastructure/errors";
import {
  mapProviderHttpError,
  parseParsPackImages,
  parseParsPackNextPage,
  parseParsPackRegions,
  parseParsPackSizes,
  parseParsPackVm,
  parseVmList,
} from "@/lib/infrastructure/parspack/mapper";
import type {
  CreateInstanceInput,
  InfrastructureProviderAdapter,
  ProviderCatalog,
  ProviderHealth,
  ProviderInstance,
} from "@/lib/infrastructure/types";

type ParsPackClientConfig = {
  managementBaseUrl?: string;
  publicBaseUrl?: string;
  /** @deprecated Use managementBaseUrl. Kept for compatibility with existing tests/callers. */
  baseUrl?: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  enabled?: boolean;
  priceCurrencyCode?: string;
  priceAmountUnit?: string;
};

type ApiScope = "management" | "public";

const catalogPageSize = 200;

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function inferPublicBaseUrl(managementBaseUrl: string): string {
  if (managementBaseUrl.endsWith("/api/v1")) {
    return `${managementBaseUrl.slice(0, -"/api/v1".length)}/api/public/v1`;
  }
  return managementBaseUrl;
}

function asProviderResponse<T>(parser: (payload: unknown) => T, payload: unknown): T {
  try {
    return parser(payload);
  } catch {
    throw new InfrastructureError(
      "provider_invalid_response",
      "ParsPack returned an invalid response",
    );
  }
}

export class ParsPackProvider implements InfrastructureProviderAdapter {
  readonly provider = InfrastructureProvider.PARSPACK;
  private readonly managementBaseUrl: string;
  private readonly publicBaseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly enabled: boolean;
  private readonly priceCurrencyCode: string;
  private readonly priceAmountUnit: string;

  constructor(config: ParsPackClientConfig) {
    const managementBaseUrl = trimBaseUrl(
      config.managementBaseUrl ?? config.baseUrl ?? "https://my.parspack.com/cserver/api/v1",
    );
    this.managementBaseUrl = managementBaseUrl;
    this.publicBaseUrl = trimBaseUrl(
      config.publicBaseUrl ?? inferPublicBaseUrl(managementBaseUrl),
    );
    this.token = config.token;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.enabled = config.enabled ?? true;
    this.priceCurrencyCode = config.priceCurrencyCode?.trim().toUpperCase() ?? "";
    this.priceAmountUnit = config.priceAmountUnit?.trim().toUpperCase() ?? "";
  }

  private ensureEnabled() {
    if (!this.enabled) {
      throw new InfrastructureError("provider_disabled", "ParsPack provider is disabled");
    }
  }

  private async request<T>(
    scope: ApiScope,
    path: string,
    init?: RequestInit,
  ): Promise<{ data: T; status: number }> {
    this.ensureEnabled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const baseUrl = scope === "management" ? this.managementBaseUrl : this.publicBaseUrl;

    try {
      const response = await this.fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Accept-Language": "en",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(init?.headers ?? {}),
        },
      });
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { message: text.slice(0, 200) };
        }
      }
      if (!response.ok) {
        const code = mapProviderHttpError(response.status, body as never);
        throw new InfrastructureError(code, "ParsPack request failed");
      }
      return { data: body as T, status: response.status };
    } catch (error) {
      if (error instanceof InfrastructureError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new InfrastructureError("provider_timeout", "ParsPack request timed out");
      }
      throw new InfrastructureError("provider_unavailable", "ParsPack is unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  private async readCatalogCollection<T>(
    path: string,
    parser: (payload: unknown) => T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;

    for (let requestCount = 0; requestCount < 20; requestCount += 1) {
      const { data } = await this.request<unknown>(
        "public",
        `${path}?page=${page}&per_page=${catalogPageSize}`,
      );
      items.push(...asProviderResponse(parser, data));

      const nextPage = parseParsPackNextPage(data);
      if (nextPage == null) return items;
      if (nextPage <= page) {
        throw new InfrastructureError(
          "provider_invalid_response",
          "ParsPack returned invalid pagination links",
        );
      }
      page = nextPage;
    }

    throw new InfrastructureError(
      "provider_invalid_response",
      "ParsPack catalog pagination exceeded the safety limit",
    );
  }

  async checkConnection(): Promise<ProviderHealth> {
    try {
      const { data } = await this.request<unknown>(
        "public",
        "/regions?page=1&per_page=1",
      );
      asProviderResponse(parseParsPackRegions, data);
      return { ok: true, message: "اتصال برقرار است", checkedAt: new Date() };
    } catch {
      return { ok: false, message: "خطای اتصال", checkedAt: new Date() };
    }
  }

  async syncCatalog(): Promise<ProviderCatalog> {
    const [regions, sizes, images] = await Promise.all([
      this.readCatalogCollection("/regions", parseParsPackRegions),
      this.readCatalogCollection("/sizes", parseParsPackSizes),
      this.readCatalogCollection("/images", parseParsPackImages),
    ]);
    const confirmed =
      this.priceCurrencyCode === "IRR" &&
      (this.priceAmountUnit === "RIAL" || this.priceAmountUnit === "TOMAN");
    return {
      priceContract: {
        currencyCode: confirmed ? this.priceCurrencyCode : null,
        amountUnit: confirmed ? this.priceAmountUnit : null,
        confirmed,
      },
      regions,
      sizes,
      images,
    };
  }

  async createInstance(input: CreateInstanceInput): Promise<ProviderInstance> {
    const { data } = await this.request<unknown>("management", "/vms", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        region: input.region,
        size: input.size,
        image: input.image,
      }),
    });
    return asProviderResponse(parseParsPackVm, data);
  }

  async getInstance(providerInstanceId: string): Promise<ProviderInstance> {
    const { data } = await this.request<unknown>(
      "public",
      `/vms/${encodeURIComponent(providerInstanceId)}`,
    );
    return asProviderResponse(parseParsPackVm, data);
  }

  async findInstanceByName(name: string): Promise<ProviderInstance | null> {
    const query = new URLSearchParams({
      name,
      page: "1",
      per_page: "20",
    });
    const { data } = await this.request<unknown>("public", `/vms?${query.toString()}`);
    const list = asProviderResponse(parseVmList, data);
    const normalized = name.trim().toLocaleLowerCase("en-US");
    return (
      list.find((vm) => vm.name.trim().toLocaleLowerCase("en-US") === normalized) ??
      null
    );
  }
}
