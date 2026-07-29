import { InfrastructureProvider } from "@prisma/client";

import { InfrastructureError } from "@/lib/infrastructure/errors";
import type {
  CreateInstanceInput,
  InfrastructureProviderAdapter,
  ProviderCatalog,
  ProviderHealth,
  ProviderInstance,
} from "@/lib/infrastructure/types";

const MOCK_CATALOG: ProviderCatalog = {
  priceContract: {
    currencyCode: "IRR",
    amountUnit: "TOMAN",
    confirmed: true,
  },
  regions: [{ code: "tehran11", name: "تهران" }],
  sizes: [
    {
      code: "irLinuxVPS4",
      name: "Linux VPS 4",
      regionCode: "tehran11",
      regionCodes: ["tehran11"],
      available: true,
      vcpu: 2,
      memoryMb: 4096,
      diskGb: 50,
      priceHourly: "1200",
      priceMonthly: "120000",
    },
  ],
  images: [{ code: "ubuntu24-cloudinit-qcow2", name: "Ubuntu 24", osFamily: "linux" }],
};

type MockRecord = ProviderInstance & { pollCount: number };

export class MockInfrastructureProvider implements InfrastructureProviderAdapter {
  readonly provider = InfrastructureProvider.PARSPACK;
  private static instances = new Map<string, MockRecord>();

  async checkConnection(): Promise<ProviderHealth> {
    return { ok: true, message: "Mock provider connected", checkedAt: new Date() };
  }

  async syncCatalog(): Promise<ProviderCatalog> {
    return MOCK_CATALOG;
  }

  async createInstance(input: CreateInstanceInput): Promise<ProviderInstance> {
    const id = `mock_vm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: MockRecord = {
      id,
      name: input.name,
      region: input.region,
      size: input.size,
      image: input.image,
      ipv4: null,
      status: "provisioning",
      pollCount: 0,
    };
    MockInfrastructureProvider.instances.set(id, record);
    return { ...record };
  }

  async getInstance(providerInstanceId: string): Promise<ProviderInstance> {
    const record = MockInfrastructureProvider.instances.get(providerInstanceId);
    if (!record) {
      throw new InfrastructureError("provider_unavailable", "Instance not found");
    }
    record.pollCount += 1;
    if (record.name.startsWith("blocked-")) {
      throw new InfrastructureError("provider_insufficient_balance", "Insufficient provider balance");
    }
    if (record.name.startsWith("ambiguous-")) {
      throw new InfrastructureError("provider_ambiguous", "Ambiguous provider response");
    }
    if (record.pollCount >= 2) {
      record.status = "active";
      record.ipv4 = "185.10.20.30";
    }
    return { ...record };
  }

  async findInstanceByName(name: string): Promise<ProviderInstance | null> {
    for (const record of MockInfrastructureProvider.instances.values()) {
      if (record.name === name) {
        return this.getInstance(record.id);
      }
    }
    return null;
  }

  static reset() {
    MockInfrastructureProvider.instances.clear();
  }
}

export function createMockProviderWithBehavior(
  behavior: "success" | "blocked" | "ambiguous" | "timeout",
): MockInfrastructureProvider {
  const provider = new MockInfrastructureProvider();
  const originalCreate = provider.createInstance.bind(provider);
  provider.createInstance = async (input) => {
    if (behavior === "blocked") {
      throw new InfrastructureError("provider_insufficient_balance", "Insufficient provider balance");
    }
    const name =
      behavior === "ambiguous"
        ? `ambiguous-${input.name}`
        : input.name;
    if (behavior === "timeout") {
      throw new InfrastructureError("provider_timeout", "Provider timeout");
    }
    return originalCreate({ ...input, name });
  };
  return provider;
}
