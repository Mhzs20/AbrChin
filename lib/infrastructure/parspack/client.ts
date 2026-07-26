import { InfrastructureProvider } from "@prisma/client";

import { InfrastructureError } from "@/lib/infrastructure/errors";
import { mapProviderHttpError, parseCatalogItems, parseParsPackVm } from "@/lib/infrastructure/parspack/mapper";
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
};

export class ParsPackProvider implements InfrastructureProviderAdapter {
  readonly provider = InfrastructureProvider.PARSPACK;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ParsPackClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
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
      if (!response.ok) {
        const code = mapProviderHttpError(response.status);
        throw new InfrastructureError(code, "ParsPack request failed");
      }
      return (await response.json()) as T;
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
      const message = error instanceof InfrastructureError ? error.message : "خطای اتصال";
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
      regions: parseCatalogItems(regionsPayload as never),
      sizes: parseCatalogItems(sizesPayload as never),
      images: parseCatalogItems(imagesPayload as never),
    };
  }

  async createInstance(input: CreateInstanceInput): Promise<ProviderInstance> {
    const payload = await this.request<ParsPackVm>("/vms", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        region: input.region,
        size: input.size,
        image: input.image,
      }),
    });
    return parseParsPackVm(payload);
  }

  async getInstance(providerInstanceId: string): Promise<ProviderInstance> {
    const payload = await this.request<ParsPackVm>(`/vms/${encodeURIComponent(providerInstanceId)}`);
    return parseParsPackVm(payload);
  }
}

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
