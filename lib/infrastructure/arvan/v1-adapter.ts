import { InfrastructureProvider } from "@prisma/client";

import type {
  CloudProviderAdapter,
  CreateServerInput,
  ProviderImage,
  ProviderNetwork,
  ProviderPlan,
  ProviderPriceSnapshot,
  ProviderRegion,
  ProviderResizeInput,
  ProviderResource,
  ProviderResourceInput,
  ProviderSecurity,
  ProviderSelection,
  ProviderSshKey,
  ProviderTask,
  ProviderTaskLookup,
  ProviderTaskStatus,
  ReconciliationInput,
  ValidationResult,
} from "@/lib/infrastructure/cloud-provider-adapter";
import { InfrastructureError } from "@/lib/infrastructure/errors";
import { parseArvanRegionCodes } from "@/lib/infrastructure/arvan/regions";
import { assertProviderRoute } from "@/lib/infrastructure/provider-routing";
import { normalizeProviderMoney } from "@/lib/pricing/provider-money";

type UnknownRecord = Record<string, unknown>;

type ArvanV1AdapterConfig = {
  apiKey: string;
  regionCodes: string[];
  baseUrl?: string;
  timeoutMs?: number;
  maxGetAttempts?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  mutationsEnabled?: boolean;
  fetchImpl?: typeof fetch;
  logger?: (entry: Record<string, unknown>) => void;
};

type ProviderResponse = {
  body: unknown;
  requestId: string | null;
  status: number;
  durationMs: number;
};

const DEFAULT_ROOT = "https://napi.arvancloud.ir/ecc/v1";
const MEBIBYTE = 1_048_576;
const GIBIBYTE = 1_073_741_824;
const DEFAULT_SECURITY_REAL_NAME = "arDefault";
const SAFE_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SECRET_KEYS = new Set([
  "authorization",
  "api_key",
  "apikey",
  "token",
  "password",
  "ssh_key",
  "init_script",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asBoolean(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  const raw = asString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unwrapCollection(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) throw new Error("provider_collection_missing");
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  if (isRecord(payload.data)) {
    for (const key of keys) {
      if (Array.isArray(payload.data[key])) return payload.data[key] as unknown[];
    }
    if (Array.isArray(payload.data.items)) return payload.data.items;
  }
  if (Array.isArray(payload.data)) return payload.data;
  throw new Error("provider_collection_missing");
}

function unwrapRecord(payload: unknown): UnknownRecord {
  if (!isRecord(payload)) return {};
  if (isRecord(payload.data)) return payload.data;
  if (isRecord(payload.server)) return payload.server;
  return payload;
}

export function normalizeArvanV1BaseUrl(value = DEFAULT_ROOT): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  let path = parsed.pathname.replace(/\/+$/, "");
  if (path.endsWith("/regions")) path = path.slice(0, -"/regions".length);
  if (/\/v3(?:\/|$)/i.test(path)) {
    throw new InfrastructureError(
      "provider_version_disabled",
      "Arvan API v3 is disabled",
    );
  }
  if (!path.endsWith("/ecc/v1")) {
    throw new InfrastructureError(
      "provider_invalid_base_url",
      "Arvan API base URL must target ECC v1",
    );
  }
  parsed.pathname = path;
  return parsed.toString().replace(/\/+$/, "");
}

function hasLegacyRegionsSuffix(value = DEFAULT_ROOT): boolean {
  try {
    return new URL(value).pathname.replace(/\/+$/, "").endsWith("/regions");
  } catch {
    return false;
  }
}

function exactPositiveUnit(
  value: unknown,
  divisor: number,
): number | null {
  const integer = asInteger(value);
  if (integer == null || integer <= 0 || integer % divisor !== 0) return null;
  const normalized = integer / divisor;
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

export function normalizeArvanPlanResources(raw: UnknownRecord): {
  ramMb: number | null;
  diskGb: number | null;
  valid: boolean;
  error: string | null;
} {
  const memoryGb = asInteger(raw.memory);
  const memoryFromBytes =
    raw.memory_in_bytes == null
      ? null
      : exactPositiveUnit(raw.memory_in_bytes, MEBIBYTE);
  const memoryFromGb =
    memoryGb != null && memoryGb > 0 && memoryGb <= Number.MAX_SAFE_INTEGER / 1024
      ? memoryGb * 1024
      : null;
  if (raw.memory_in_bytes != null && memoryFromBytes == null) {
    return {
      ramMb: null,
      diskGb: null,
      valid: false,
      error: "invalid_memory_in_bytes",
    };
  }
  if (memoryFromBytes != null && memoryFromGb != null && memoryFromBytes !== memoryFromGb) {
    return {
      ramMb: null,
      diskGb: null,
      valid: false,
      error: "memory_unit_mismatch",
    };
  }
  const ramMb = memoryFromBytes ?? memoryFromGb;
  if (ramMb == null || !Number.isSafeInteger(ramMb) || ramMb <= 0) {
    return {
      ramMb: null,
      diskGb: null,
      valid: false,
      error: "invalid_memory",
    };
  }

  const diskGb = asInteger(raw.disk);
  const diskFromBytes =
    raw.disk_in_bytes == null
      ? null
      : exactPositiveUnit(raw.disk_in_bytes, GIBIBYTE);
  if (
    diskGb == null ||
    diskGb <= 0 ||
    (raw.disk_in_bytes != null && diskFromBytes == null) ||
    (diskFromBytes != null && diskFromBytes !== diskGb)
  ) {
    return {
      ramMb: null,
      diskGb: null,
      valid: false,
      error:
        diskFromBytes != null && diskGb != null && diskFromBytes !== diskGb
          ? "disk_unit_mismatch"
          : "invalid_disk",
    };
  }
  return { ramMb, diskGb, valid: true, error: null };
}

export function redactProviderData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactProviderData);
  if (!isRecord(value)) return value;
  const safe: UnknownRecord = {};
  for (const [key, item] of Object.entries(value)) {
    safe[key] = SECRET_KEYS.has(key.toLowerCase())
      ? "[REDACTED]"
      : redactProviderData(item);
  }
  return safe;
}

function serverState(raw: UnknownRecord): ProviderTask["state"] {
  const state = asString(raw.status).toLowerCase();
  if (state === "active" || state === "shutoff") return "SUCCEEDED";
  if (state === "error" || state === "deleted" || state === "soft_deleted") {
    return "FAILED";
  }
  return "RUNNING";
}

function ipv4FromServer(raw: UnknownRecord): string | null {
  if (!isRecord(raw.addresses)) return null;
  for (const addresses of Object.values(raw.addresses)) {
    if (!Array.isArray(addresses)) continue;
    for (const address of addresses) {
      if (!isRecord(address)) continue;
      if (asInteger(address.version) === 4 && asString(address.addr)) {
        return asString(address.addr);
      }
    }
  }
  return null;
}

function parseResource(raw: UnknownRecord, region: string): ProviderResource {
  const id = asString(raw.id);
  if (!id) throw new Error("provider_resource_id_missing");
  const networkIds = Array.isArray(raw.network_ids)
    ? raw.network_ids.map(asString).filter(Boolean)
    : asString(raw.network_id)
      ? [asString(raw.network_id)]
    : Array.isArray(raw.networks)
      ? raw.networks
          .map((network) =>
            isRecord(network)
              ? asString(network.id) || asString(network.network_id)
              : asString(network),
          )
          .filter(Boolean)
      : isRecord(raw.addresses)
        ? Object.keys(raw.addresses).filter(Boolean)
        : null;
  const securityIds = Array.isArray(raw.security_groups)
    ? raw.security_groups
        .map((security) =>
          isRecord(security)
            ? asString(security.id) || asString(security.name)
            : asString(security),
        )
        .filter(Boolean)
    : null;
  const flavor = isRecord(raw.flavor) ? raw.flavor : null;
  const image = isRecord(raw.image) ? raw.image : null;
  return {
    id,
    name: asString(raw.name),
    region,
    externalPlanId:
      asString(raw.flavor_id) ||
      asString(raw.plan_id) ||
      (flavor ? asString(flavor.id) : "") ||
      null,
    externalImageId:
      asString(raw.image_id) ||
      (image ? asString(image.id) : "") ||
      null,
    state: asString(raw.status) || "unknown",
    ipv4: ipv4FromServer(raw),
    networkIds,
    securityIds,
    observedAt: new Date(),
    rawPayload: redactProviderData(raw) as UnknownRecord,
  };
}

export class ArvanV1Adapter implements CloudProviderAdapter {
  readonly provider = InfrastructureProvider.ARVAN;
  readonly apiVersion = "v1";
  readonly topologyVerificationMode = "STRICT_OBSERVED" as const;
  readonly billingPolicy = {
    verificationStatus: "UNVERIFIED",
    settlementSupported: false,
    calculationUnit: "UNVERIFIED",
    minimumChargeSeconds: null,
    roundingPolicy: "UNVERIFIED",
    prorationSupported: null,
    hourlyRateAvailable: true,
    dailyRateAvailable: false,
    stopStateBillableComponents: {
      compute: "UNVERIFIED",
      disk: "UNVERIFIED",
      ip: "UNVERIFIED",
      backup: "UNVERIFIED",
      traffic: "UNVERIFIED",
      snapshot: "UNVERIFIED",
    },
  } as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxGetAttempts: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitCooldownMs: number;
  private readonly mutationsEnabled: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (entry: Record<string, unknown>) => void;
  private readonly regionCodes: string[];
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(config: ArvanV1AdapterConfig) {
    this.apiKey = config.apiKey.trim();
    this.regionCodes = parseArvanRegionCodes(config.regionCodes.join(","));
    this.baseUrl = normalizeArvanV1BaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxGetAttempts = Math.min(Math.max(config.maxGetAttempts ?? 3, 1), 4);
    this.circuitFailureThreshold = Math.max(
      config.circuitFailureThreshold ?? 5,
      1,
    );
    this.circuitCooldownMs = Math.max(config.circuitCooldownMs ?? 30_000, 1_000);
    this.mutationsEnabled = config.mutationsEnabled === true;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.logger = config.logger ?? (() => undefined);
    if (hasLegacyRegionsSuffix(config.baseUrl)) {
      this.logger({
        event: "provider_configuration_warning",
        provider: this.provider,
        apiVersion: this.apiVersion,
        code: "legacy_regions_base_url_normalized",
      });
    }
    if (!this.apiKey) {
      throw new InfrastructureError(
        "provider_disabled",
        "Arvan provider is not configured",
      );
    }
  }

  private ensureCircuitClosed(): void {
    if (this.circuitOpenedAt == null) return;
    if (Date.now() - this.circuitOpenedAt >= this.circuitCooldownMs) {
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
      return;
    }
    throw new InfrastructureError(
      "provider_circuit_open",
      "Arvan provider is temporarily unavailable",
    );
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.circuitOpenedAt = Date.now();
    }
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<ProviderResponse> {
    this.ensureCircuitClosed();
    if (method !== "GET" && !this.mutationsEnabled) {
      throw new InfrastructureError(
        "provider_mutation_disabled",
        "Arvan lifecycle mutations are disabled",
      );
    }
    const attempts = method === "GET" ? this.maxGetAttempts : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Apikey ${this.apiKey}`,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const durationMs = Date.now() - startedAt;
        const requestId =
          response.headers.get("x-request-id") ??
          response.headers.get("x-correlation-id") ??
          response.headers.get("request-id");
        const text = await response.text();
        let payload: unknown = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = { message: text.slice(0, 200) };
          }
        }
        this.logger({
          event: "provider_request",
          provider: this.provider,
          apiVersion: this.apiVersion,
          endpoint: path,
          method,
          status: response.status,
          requestId,
          durationMs,
          attempt,
        });
        if (!response.ok) {
          const retryable = method === "GET" && SAFE_RETRY_STATUSES.has(response.status);
          if (retryable && attempt < attempts) {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(100 * 2 ** (attempt - 1), 800)),
            );
            continue;
          }
          if (response.status === 401 || response.status === 403) {
            throw new InfrastructureError(
              "provider_auth_failed",
              "Arvan authentication failed",
            );
          }
          if (response.status === 404) {
            throw new InfrastructureError(
              "provider_not_found",
              "Arvan resource was not found",
            );
          }
          throw new InfrastructureError(
            "provider_unavailable",
            "Arvan request failed",
          );
        }
        this.consecutiveFailures = 0;
        return {
          body: payload,
          requestId,
          status: response.status,
          durationMs,
        };
      } catch (error) {
        lastError = error;
        const isAbort = error instanceof Error && error.name === "AbortError";
        if (
          method === "GET" &&
          attempt < attempts &&
          (isAbort || !(error instanceof InfrastructureError))
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(100 * 2 ** (attempt - 1), 800)),
          );
          continue;
        }
        this.recordFailure();
        if (error instanceof InfrastructureError) throw error;
        if (isAbort) {
          throw new InfrastructureError(
            "provider_timeout",
            "Arvan request timed out",
          );
        }
        throw new InfrastructureError(
          "provider_unavailable",
          "Arvan is unavailable",
        );
      } finally {
        clearTimeout(timer);
      }
    }
    this.recordFailure();
    throw lastError instanceof Error
      ? lastError
      : new InfrastructureError("provider_unavailable", "Arvan is unavailable");
  }

  async syncRegions(): Promise<ProviderRegion[]> {
    if (this.regionCodes.length === 0) {
      throw new InfrastructureError(
        "provider_invalid_region_config",
        "No enabled provider region is configured",
      );
    }
    return this.regionCodes.map((code) => ({
      code,
      // Provider identity remains the configured code. Localized names belong
      // to the presentation layer and never change catalog identity.
      name: code,
      available: true,
      rawPayload: { code, source: "database_configuration" },
    }));
  }

  async syncPlans(region: string): Promise<ProviderPlan[]> {
    const response = await this.request(
      "GET",
      `/regions/${encodeURIComponent(region)}/sizes`,
    );
    return unwrapCollection(response.body, ["sizes", "plans"])
      .filter(isRecord)
      .map((raw) => {
        const externalPlanId = asString(raw.id);
        const resources = normalizeArvanPlanResources(raw);
        const vcpu = asInteger(raw.cpu_count);
        let priceHourlyIrr: bigint | null = null;
        let priceMonthlyIrr: bigint | null = null;
        try {
          priceHourlyIrr = normalizeProviderMoney(
            this.provider,
            raw.price_per_hour,
            "IRR",
          );
          priceMonthlyIrr = normalizeProviderMoney(
            this.provider,
            raw.price_per_month,
            "IRR",
          );
        } catch {
          priceHourlyIrr = null;
          priceMonthlyIrr = null;
        }
        return {
          externalPlanId,
          region,
          name: asString(raw.name) || externalPlanId,
          vcpu,
          ramMb: resources.ramMb,
          diskGb: resources.diskGb,
          resourceContractValid:
            resources.valid && vcpu != null && vcpu > 0,
          resourceContractError:
            resources.error ??
            (vcpu == null || vcpu <= 0 ? "invalid_cpu" : null),
          available:
            externalPlanId.length > 0 &&
            resources.valid &&
            vcpu != null &&
            vcpu > 0 &&
            priceMonthlyIrr != null &&
            priceMonthlyIrr > 0n,
          priceHourlyIrr:
            priceHourlyIrr != null && priceHourlyIrr > 0n
              ? priceHourlyIrr
              : null,
          priceMonthlyIrr:
            priceMonthlyIrr != null && priceMonthlyIrr > 0n
              ? priceMonthlyIrr
              : null,
          sourceMoneyUnit: "IRR",
          rawUpdatedAt: parseDate(raw.updated_at),
          rawPayload: redactProviderData(raw) as UnknownRecord,
          ...(response.requestId
            ? { providerRequestId: response.requestId }
            : {}),
        };
      })
      .filter((plan) => plan.externalPlanId.length > 0);
  }

  async syncImages(region: string): Promise<ProviderImage[]> {
    const response = await this.request(
      "GET",
      `/regions/${encodeURIComponent(region)}/images?type=distributions`,
    );
    const groups = unwrapCollection(response.body, ["images", "distributions"]);
    const images: ProviderImage[] = [];
    for (const groupValue of groups) {
      if (!isRecord(groupValue)) continue;
      const group = asString(groupValue.name) || asString(groupValue.group);
      const groupImages = Array.isArray(groupValue.images)
        ? groupValue.images
        : [groupValue];
      for (const imageValue of groupImages) {
        if (!isRecord(imageValue)) continue;
        const externalId = asString(imageValue.id);
        if (!externalId) continue;
        images.push({
          externalId,
          region,
          name: asString(imageValue.name) || externalId,
          operatingSystem:
            asString(imageValue.distribution_name) ||
            asString(imageValue.os_description) ||
            group ||
            null,
          minDiskGb: asInteger(imageValue.disk),
          minRamMb: asInteger(imageValue.ram),
          available: true,
          sshKeySupported:
            typeof imageValue.ssh_key === "boolean"
              ? imageValue.ssh_key
              : null,
          sshPasswordSupported:
            typeof imageValue.ssh_password === "boolean"
              ? imageValue.ssh_password
              : null,
          rawUpdatedAt: parseDate(imageValue.updated_at),
          rawPayload: redactProviderData({
            group,
            ...imageValue,
          }) as UnknownRecord,
          ...(response.requestId
            ? { providerRequestId: response.requestId }
            : {}),
        });
      }
    }
    return images;
  }

  async syncNetworks(region: string): Promise<ProviderNetwork[]> {
    const [response, optionsResponse] = await Promise.all([
      this.request(
        "GET",
        `/regions/${encodeURIComponent(region)}/networks`,
      ),
      this.request(
        "GET",
        `/regions/${encodeURIComponent(region)}/servers/options`,
      ),
    ]);
    const options = unwrapRecord(optionsResponse.body);
    const defaultNetworkId = asString(options.network_id);
    return unwrapCollection(response.body, ["networks"])
      .filter(isRecord)
      .map((raw) => ({
        externalId: asString(raw.id),
        region,
        name: asString(raw.name) || asString(raw.id),
        isDefault:
          defaultNetworkId.length > 0 &&
          asString(raw.id) === defaultNetworkId,
        available:
          asBoolean(raw.admin_state_up, true) &&
          !["down", "error"].includes(asString(raw.status).toLowerCase()),
        rawUpdatedAt: parseDate(raw.updated_at),
        rawPayload: redactProviderData(raw) as UnknownRecord,
        ...(response.requestId
          ? { providerRequestId: response.requestId }
          : {}),
      }))
      .filter((network) => network.externalId.length > 0);
  }

  async syncSecurity(region: string): Promise<ProviderSecurity[]> {
    const response = await this.request(
      "GET",
      `/regions/${encodeURIComponent(region)}/securities`,
    );
    return unwrapCollection(response.body, ["securities", "security_groups"])
      .filter(isRecord)
      .map((raw) => ({
        externalId: asString(raw.id),
        region,
        name: asString(raw.name) || asString(raw.id),
        isDefault:
          asString(raw.real_name) === DEFAULT_SECURITY_REAL_NAME ||
          asString(raw.name) === DEFAULT_SECURITY_REAL_NAME,
        available: asString(raw.status).toLowerCase() !== "error",
        rawUpdatedAt: parseDate(raw.updated_at),
        rawPayload: redactProviderData(raw) as UnknownRecord,
        ...(response.requestId
          ? { providerRequestId: response.requestId }
          : {}),
      }))
      .filter((security) => security.externalId.length > 0);
  }

  async listSshKeys(region: string): Promise<ProviderSshKey[]> {
    const response = await this.request(
      "GET",
      `/regions/${encodeURIComponent(region)}/ssh-keys`,
    );
    return unwrapCollection(response.body, ["ssh_keys", "keys"])
      .filter(isRecord)
      .map((raw) => ({
        id: asString(raw.id) || null,
        name: asString(raw.name),
        fingerprint: asString(raw.fingerprint) || null,
        publicKey: asString(raw.public_key) || null,
      }))
      .filter((key) => key.name.length > 0);
  }

  async resolveSelectionDefaults(region: string) {
    const [networks, securities] = await Promise.all([
      this.syncNetworks(region),
      this.syncSecurity(region),
    ]);
    const network = networks.find(
      (candidate) => candidate.available && candidate.isDefault,
    );
    const security = securities.find(
      (candidate) => candidate.available && candidate.isDefault,
    );
    if (!network || !security) {
      throw new InfrastructureError(
        "provider_default_selection_missing",
        "Arvan default network or security group is unavailable",
      );
    }
    return {
      region,
      externalNetworkId: network.externalId,
      externalSecurityId: security.externalId,
      topologyVerificationMode: this.topologyVerificationMode,
      checkedAt: new Date(),
      providerRequestIds: [
        network.providerRequestId,
        security.providerRequestId,
      ].filter((value): value is string => Boolean(value)),
    };
  }

  async validateSelection(
    input: ProviderSelection,
  ): Promise<ValidationResult> {
    try {
      assertProviderRoute({
        productKind: input.productKind,
        provider: this.provider,
        apiVersion: this.apiVersion,
      });
    } catch {
      return {
        valid: false,
        code: "product_kind_mismatch",
        checkedAt: new Date(),
      };
    }
    const [plans, images, networks, securities] = await Promise.all([
      this.syncPlans(input.region),
      this.syncImages(input.region),
      input.externalNetworkId
        ? this.syncNetworks(input.region)
        : Promise.resolve([]),
      input.externalSecurityId
        ? this.syncSecurity(input.region)
        : Promise.resolve([]),
    ]);
    const plan = plans.find(
      (candidate) => candidate.externalPlanId === input.externalPlanId,
    );
    if (!plan?.available) {
      return {
        valid: false,
        code: "plan_unavailable",
        checkedAt: new Date(),
      };
    }
    if (!plan.resourceContractValid) {
      return {
        valid: false,
        code: "invalid_resource_contract",
        checkedAt: new Date(),
      };
    }
    if (!plan.priceMonthlyIrr || plan.priceMonthlyIrr <= 0n) {
      return { valid: false, code: "invalid_price", checkedAt: new Date() };
    }
    const image = images.find(
      (candidate) => candidate.externalId === input.externalImageId,
    );
    if (
      !image?.available ||
      (image.minDiskGb != null &&
        plan.diskGb != null &&
        image.minDiskGb > plan.diskGb) ||
      (image.minRamMb != null &&
        plan.ramMb != null &&
        image.minRamMb > plan.ramMb)
    ) {
      return {
        valid: false,
        code: "image_incompatible",
        checkedAt: new Date(),
      };
    }
    if (
      input.externalNetworkId &&
      !networks.some(
        (network) =>
          network.externalId === input.externalNetworkId && network.available,
      )
    ) {
      return {
        valid: false,
        code: "network_unavailable",
        checkedAt: new Date(),
      };
    }
    if (
      input.externalSecurityId &&
      !securities.some(
        (security) =>
          security.externalId === input.externalSecurityId &&
          security.available,
      )
    ) {
      return {
        valid: false,
        code: "security_unavailable",
        checkedAt: new Date(),
      };
    }
    return { valid: true, checkedAt: new Date() };
  }

  async refreshPrice(
    input: ProviderSelection,
  ): Promise<ProviderPriceSnapshot> {
    assertProviderRoute({
      productKind: input.productKind,
      provider: this.provider,
      apiVersion: this.apiVersion,
    });
    const plan = (await this.syncPlans(input.region)).find(
      (candidate) => candidate.externalPlanId === input.externalPlanId,
    );
    if (!plan?.available || !plan.priceMonthlyIrr) {
      throw new InfrastructureError(
        "provider_unavailable",
        "Arvan plan is not sellable",
      );
    }
    return {
      provider: this.provider,
      apiVersion: this.apiVersion,
      productKind: input.productKind,
      region: input.region,
      externalPlanId: input.externalPlanId,
      hourlyPriceIrr: plan.priceHourlyIrr,
      monthlyPriceIrr: plan.priceMonthlyIrr,
      currency: "IRR",
      available: true,
      checkedAt: new Date(),
      providerRequestId: plan.providerRequestId,
      rawPayload: plan.rawPayload,
    };
  }

  private taskFromResponse(response: ProviderResponse): ProviderTask {
    const raw = unwrapRecord(response.body);
    const resourceId = asString(raw.id) || null;
    return {
      // The official v1 Terraform client polls the server resource. It does
      // not define a separate action/task lookup endpoint.
      taskId: null,
      actionId: null,
      resourceId,
      requestId: response.requestId,
      state: resourceId ? serverState(raw) : "SUBMITTED",
      submittedAt: new Date(),
    };
  }

  async createServer(input: CreateServerInput): Promise<ProviderTask> {
    assertProviderRoute({
      productKind: input.productKind,
      provider: this.provider,
      apiVersion: this.apiVersion,
    });
    if (!input.externalNetworkId || !input.externalSecurityId) {
      throw new InfrastructureError(
        "provider_default_selection_missing",
        "Arvan network and security group must be locked before create",
      );
    }
    const response = await this.request(
      "POST",
      `/regions/${encodeURIComponent(input.region)}/servers`,
      {
        name: input.name,
        network_ids: [input.externalNetworkId],
        flavor_id: input.externalPlanId,
        image_id: input.externalImageId,
        security_groups: [{ name: input.externalSecurityId }],
        ssh_key: input.sshKeyEnabled === true,
        key_name: input.sshKeyName ?? null,
        count: 1,
        create_type: "new",
        disk_size: input.diskSizeGb ?? 0,
        init_script: input.initScript ?? "",
        ha_enabled: false,
      },
    );
    return this.taskFromResponse(response);
  }

  async getTaskStatus(
    input: ProviderTaskLookup,
  ): Promise<ProviderTaskStatus> {
    if (!input.resourceId) {
      throw new InfrastructureError(
        "provider_not_found",
        "Arvan v1 polling requires a resource id",
      );
    }
    const response = await this.request(
      "GET",
      `/regions/${encodeURIComponent(input.region)}/servers/${encodeURIComponent(input.resourceId)}`,
    );
    const raw = unwrapRecord(response.body);
    return {
      taskId: input.taskId ?? null,
      actionId: null,
      resourceId: asString(raw.id) || input.resourceId,
      requestId: response.requestId,
      state: serverState(raw),
      submittedAt: parseDate(raw.created) ?? new Date(),
      checkedAt: new Date(),
      failureCode:
        serverState(raw) === "FAILED"
          ? asString(raw.task_state) || "provider_failed"
          : null,
    };
  }

  async findExistingResource(
    input: ReconciliationInput,
  ): Promise<ProviderResource | null> {
    if (input.providerResourceId) {
      const response = await this.request(
        "GET",
        `/regions/${encodeURIComponent(input.region)}/servers/${encodeURIComponent(input.providerResourceId)}`,
      );
      return parseResource(unwrapRecord(response.body), input.region);
    }
    const response = await this.request(
      "GET",
      `/regions/${encodeURIComponent(input.region)}/servers`,
    );
    const matches = unwrapCollection(response.body, ["servers"])
      .filter(isRecord)
      .filter((server) => asString(server.name) === input.expectedName);
    if (matches.length > 1) {
      throw new InfrastructureError(
        "provider_ambiguous",
        "Multiple Arvan resources match the locked order",
      );
    }
    return matches[0] ? parseResource(matches[0], input.region) : null;
  }

  private async serverAction(
    action: string,
    input: ProviderResourceInput,
    body?: unknown,
  ): Promise<ProviderTask> {
    const response = await this.request(
      "POST",
      `/regions/${encodeURIComponent(input.region)}/servers/${encodeURIComponent(input.resourceId)}/${action}`,
      body,
    );
    return {
      ...this.taskFromResponse(response),
      resourceId: input.resourceId,
    };
  }

  powerOn(input: ProviderResourceInput): Promise<ProviderTask> {
    return this.serverAction("power-on", input);
  }

  powerOff(input: ProviderResourceInput): Promise<ProviderTask> {
    return this.serverAction("power-off", input);
  }

  reboot(input: ProviderResourceInput): Promise<ProviderTask> {
    return this.serverAction("reboot", input);
  }

  resize(input: ProviderResizeInput): Promise<ProviderTask> {
    return this.serverAction("resize", input, {
      flavor_id: input.externalPlanId,
    });
  }

  async terminate(input: ProviderResourceInput): Promise<ProviderTask> {
    const response = await this.request(
      "DELETE",
      `/regions/${encodeURIComponent(input.region)}/servers/${encodeURIComponent(input.resourceId)}?forceDelete=true`,
    );
    return {
      ...this.taskFromResponse(response),
      resourceId: input.resourceId,
    };
  }
}
