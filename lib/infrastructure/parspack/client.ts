import { InfrastructureProvider } from "@prisma/client";

import { InfrastructureError } from "@/lib/infrastructure/errors";
import {
  mapProviderHttpError,
  parseCatalogItems,
  parseParsPackVm,
  parseVmList,
  sanitizeProviderResponse,
} from "@/lib/infrastructure/parspack/mapper";
import type {
  CreateInstanceInput,
  InfrastructureProviderAdapter,
  ProviderCatalog,
  ProviderHealth,
  ProviderInstance,
} from "@/lib/infrastructure/types";

type ParsPackClientConfig = {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  enabled?: boolean;
};

type ParsPackListResponse<T> = {
  data?: T[];
  items?: T[];
};

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

export class ParsPackProvider implements InfrastructureProviderAdapter {
  readonly provider = InfrastructureProvider.PARSPACK;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly enabled: boolean;

  constructor(config: ParsPackClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.enabled = config.enabled ?? true;
  }

  private ensureEnabled() {
    if (!this.enabled) {
      throw new InfrastructureError("provider_disabled", "ParsPack provider is disabled");
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<{ data: T; status: number }> {
    this.ensureEnabled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
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

  async checkConnection(): Promise<ProviderHealth> {
    try {
      await this.request("/regions");
      return { ok: true, message: "اتصال برقرار است", checkedAt: new Date() };
    } catch (error) {
      const message = error instanceof InfrastructureError ? "خطای اتصال" : "خطای اتصال";
      return { ok: false, message, checkedAt: new Date() };
    }
  }

  async syncCatalog(): Promise<ProviderCatalog> {
    const [regionsPayload, sizesPayload, imagesPayload] = await Promise.all([
      this.request<unknown>("/regions"),
      this.request<unknown>("/sizes"),
      this.request<unknown>("/images"),
    ]);
    return {
      regions: parseCatalogItems(regionsPayload.data as never),
      sizes: parseCatalogItems(sizesPayload.data as never),
      images: parseCatalogItems(imagesPayload.data as never),
    };
  }

  async createInstance(input: CreateInstanceInput): Promise<ProviderInstance> {
    const { data, status } = await this.request<ParsPackVm>("/vms", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        region: input.region,
        size: input.size,
        image: input.image,
      }),
    });
    void sanitizeProviderResponse({ status, body: data });
    return parseParsPackVm(data);
  }

  async getInstance(providerInstanceId: string): Promise<ProviderInstance> {
    const { data } = await this.request<ParsPackVm>(`/vms/${encodeURIComponent(providerInstanceId)}`);
    return parseParsPackVm(data);
  }

  async findInstanceByName(name: string): Promise<ProviderInstance | null> {
    const { data } = await this.request<ParsPackListResponse<ParsPackVm> | ParsPackVm[]>("/vms");
    const list = parseVmList(data);
    const match = list.find((vm) => vm.name === name);
    return match ?? null;
  }
}